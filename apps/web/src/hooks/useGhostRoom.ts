"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decryptFromWire,
  encryptToWire,
  deriveSharedKey,
  publicKeyToBase64,
  publicKeyFromBase64,
  safetyNumberFromKey,
  type KeyPair,
} from "@ghostchat/crypto";
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
} from "@ghostchat/protocol";
import { generateMessageId, parseTtlMs, type TtlMode } from "@ghostchat/shared";
import { getWsUrl } from "@/lib/config";
import { clearRoomKeyPair, getOrCreateRoomKeyPair } from "@/lib/keys";
import {
  clearRoomSession,
  getOrCreateDisplayId,
  getOrCreateSessionToken,
  sessionSet,
} from "@/lib/session";

export type ChatMessage = {
  id: string;
  from: string;
  text: string;
  mine: boolean;
  ttlMode: TtlMode;
  receivedAt: number;
  burning?: boolean;
};

export type RoomConnectionState =
  | "connecting"
  | "waiting_peer"
  | "ready"
  | "peer_left"
  | "closed"
  | "error";

type Options = {
  roomId: string;
  defaultTtl?: TtlMode;
};

const PING_MS = 25_000;
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 8_000;
const MAX_RECONNECT = 6;

export function useGhostRoom({ roomId, defaultTtl = "60s" }: Options) {
  const [state, setState] = useState<RoomConnectionState>("connecting");
  const [myId, setMyId] = useState<string | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [meTyping, setMeTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ttlMode, setTtlMode] = useState<TtlMode>(defaultTtl);
  const [error, setError] = useState<string | null>(null);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const keyPairRef = useRef<KeyPair | null>(null);
  const sharedKeyRef = useRef<Uint8Array | null>(null);
  const roomIdRef = useRef(roomId);
  const intentionalClose = useRef(false);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burnTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttlModeRef = useRef(ttlMode);
  const myIdRef = useRef(myId);
  const stateRef = useRef(state);

  roomIdRef.current = roomId;
  ttlModeRef.current = ttlMode;
  myIdRef.current = myId;
  stateRef.current = state;

  const clearBurnTimers = useCallback(() => {
    burnTimers.current.forEach((t) => clearTimeout(t));
    burnTimers.current.clear();
  }, []);

  const burnMessage = useCallback((messageId: string, notifyPeer: boolean) => {
    setMessages((prev) => {
      if (!prev.some((m) => m.id === messageId)) return prev;
      return prev.map((m) =>
        m.id === messageId ? { ...m, burning: true } : m
      );
    });
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    }, 400);

    const t = burnTimers.current.get(messageId);
    if (t) {
      clearTimeout(t);
      burnTimers.current.delete(messageId);
    }

    if (notifyPeer && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "burn",
          messageId,
        })
      );
    }
  }, []);

  const scheduleTtl = useCallback(
    (messageId: string, mode: TtlMode, mine: boolean) => {
      const ms = parseTtlMs(mode);
      if (ms === null) {
        if (!mine) {
          const t = setTimeout(() => burnMessage(messageId, true), 2500);
          burnTimers.current.set(messageId, t);
        }
        return;
      }
      const t = setTimeout(() => burnMessage(messageId, !mine), ms);
      burnTimers.current.set(messageId, t);
    },
    [burnMessage]
  );

  const establishShared = useCallback(
    (peerPublicKeyB64: string, rid: string) => {
      const kp = keyPairRef.current;
      if (!kp) return false;
      try {
        const key = deriveSharedKey(
          kp.privateKey,
          publicKeyFromBase64(peerPublicKeyB64),
          rid
        );
        sharedKeyRef.current = key;
        setSafetyNumber(safetyNumberFromKey(key));
        return true;
      } catch {
        setError("Key exchange failed");
        setSafetyNumber(null);
        return false;
      }
    },
    []
  );

  const onServerRef = useRef<(msg: ServerMessage) => void>(() => {});
  onServerRef.current = (msg: ServerMessage) => {
    const rid = roomIdRef.current;
    switch (msg.type) {
      case "joined": {
        setMyId(msg.yourId);
        setError(null);
        // Persist server-echoed token (may match client-created one)
        if (msg.sessionToken) sessionSet(`session:${rid}`, msg.sessionToken);
        if (msg.yourId) sessionSet(`display:${rid}`, msg.yourId);
        if (msg.peerId && msg.peerPublicKey) {
          if (establishShared(msg.peerPublicKey, rid)) {
            setPeerId(msg.peerId);
            setState("ready");
          } else {
            setState("error");
          }
        } else {
          setPeerId(null);
          setSafetyNumber(null);
          sharedKeyRef.current = null;
          setState("waiting_peer");
        }
        break;
      }
      case "peer_joined": {
        if (!msg.peerPublicKey || !msg.peerId) break;
        if (establishShared(msg.peerPublicKey, rid)) {
          setPeerId(msg.peerId);
          setError(null);
          setState("ready");
        } else {
          setError("Key exchange failed when peer joined");
          setState("error");
        }
        break;
      }
      case "peer_left": {
        setPeerId(null);
        sharedKeyRef.current = null;
        setSafetyNumber(null);
        setPeerTyping(false);
        setState("peer_left");
        break;
      }
      case "message": {
        if (!sharedKeyRef.current) {
          setError("Received message but no shared key — reconnecting…");
          break;
        }
        try {
          const text = decryptFromWire(
            sharedKeyRef.current,
            msg.ciphertext,
            msg.nonce
          );
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.messageId)) return prev;
            return [
              ...prev,
              {
                id: msg.messageId,
                from: msg.from,
                text,
                mine: false,
                ttlMode: msg.ttlMode,
                receivedAt: Date.now(),
              },
            ];
          });
          scheduleTtl(msg.messageId, msg.ttlMode, false);
          setPeerTyping(false);
        } catch {
          setError("Failed to decrypt a message (key mismatch?)");
        }
        break;
      }
      case "typing":
        setPeerTyping(msg.state);
        break;
      case "burn":
        burnMessage(msg.messageId, false);
        break;
      case "error": {
        const label =
          msg.code === "room_not_found"
            ? "Room not found or already destroyed"
            : msg.code === "room_full"
              ? "Room is full"
              : msg.code === "rate_limited"
                ? "Rate limited — slow down"
                : (msg.message ?? msg.code);
        setError(label);
        if (msg.code === "room_full" || msg.code === "room_not_found") {
          setState("error");
          intentionalClose.current = true;
        }
        break;
      }
      case "room_closed": {
        setState("closed");
        setError(`Room closed: ${msg.reason}`);
        clearRoomSession(rid);
        clearRoomKeyPair(rid);
        intentionalClose.current = true;
        break;
      }
      case "pong":
        break;
    }
  };

  useEffect(() => {
    intentionalClose.current = false;
    reconnectAttempt.current = 0;
    setState("connecting");
    setError(null);
    setPeerId(null);
    setPeerTyping(false);
    setMeTyping(false);
    setMessages([]);
    setSafetyNumber(null);
    sharedKeyRef.current = null;

    // Stable identity across Strict Mode remounts (must exist BEFORE first join)
    const kp = getOrCreateRoomKeyPair(roomId);
    keyPairRef.current = kp;
    const displayId = getOrCreateDisplayId(roomId);
    const sessionToken = getOrCreateSessionToken(roomId);
    setMyId(displayId);

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;

      // Always reuse same token — never join as a second session in one tab
      const token = getOrCreateSessionToken(roomId);
      const url = getWsUrl(roomId);
      setState((s) =>
        s === "ready" || s === "waiting_peer" || s === "peer_left"
          ? s
          : "connecting"
      );

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        setError("Cannot open WebSocket — is the worker running on :8787?");
        setState("error");
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        setError(null);
        ws.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "join",
            displayId,
            publicKey: publicKeyToBase64(kp.publicKey),
            sessionToken: token,
          })
        );
      };

      ws.onmessage = (ev) => {
        try {
          const msg = parseServerMessage(JSON.parse(String(ev.data)));
          if (msg) onServerRef.current(msg);
        } catch {
          /* ignore malformed */
        }
      };

      ws.onerror = () => {
        if (reconnectAttempt.current === 0 && !disposed) {
          setError(
            `Connection failed (${url}). Start worker: pnpm dev:worker`
          );
        }
      };

      ws.onclose = () => {
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed || intentionalClose.current) {
          setState((s) => (s === "error" || s === "closed" ? s : "closed"));
          return;
        }

        if (reconnectAttempt.current >= MAX_RECONNECT) {
          setError("Disconnected — could not reconnect");
          setState("error");
          return;
        }

        const attempt = reconnectAttempt.current++;
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attempt,
          RECONNECT_MAX_MS
        );
        setState("connecting");
        reconnectTimer.current = setTimeout(connect, delay);
      };

      pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "ping" }));
        }
      }, PING_MS);
    };

    connect();

    return () => {
      disposed = true;
      // Do not set intentionalClose here for Strict Mode — only stop this
      // effect's timers/socket. Leave intentionalClose for leaveRoom/errors.
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer) clearInterval(pingTimer);
      clearBurnTimers();
      if (typingTimer.current) clearTimeout(typingTimer.current);
      try {
        // Prefer close without marking session ended
        wsRef.current?.close(1000, "remount");
      } catch {
        /* ignore */
      }
      if (wsRef.current) wsRef.current = null;
      // Keep keyPair in module store; only clear shared key for this instance
      sharedKeyRef.current = null;
    };
  }, [roomId, clearBurnTimers]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const ws = wsRef.current;
      const key = sharedKeyRef.current;

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("Not connected — wait a moment or refresh");
        return false;
      }
      if (!key) {
        setError(
          stateRef.current === "waiting_peer" ||
            stateRef.current === "peer_left"
            ? "Waiting for peer before you can send"
            : "Encryption not ready — wait for peer"
        );
        return false;
      }

      try {
        const messageId = generateMessageId();
        const mode = ttlModeRef.current;
        const wire = encryptToWire(key, trimmed);
        ws.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "message",
            ciphertext: wire.ciphertext,
            nonce: wire.nonce,
            ttlMode: mode,
            messageId,
          })
        );

        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            from: myIdRef.current ?? "You",
            text: trimmed,
            mine: true,
            ttlMode: mode,
            receivedAt: Date.now(),
          },
        ]);
        scheduleTtl(messageId, mode, true);
        setMeTyping(false);
        ws.send(
          JSON.stringify({ v: PROTOCOL_VERSION, type: "typing", state: false })
        );
        setError(null);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send");
        return false;
      }
    },
    [scheduleTtl]
  );

  const lastTypingSent = useRef(false);

  const notifyTyping = useCallback((isTyping: boolean) => {
    const ws = wsRef.current;
    const sendTyping = (state: boolean) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      if (state === lastTypingSent.current) return;
      lastTypingSent.current = state;
      wsRef.current.send(
        JSON.stringify({ v: PROTOCOL_VERSION, type: "typing", state })
      );
    };

    if (isTyping) {
      // Always re-show local ASCII after a pause
      setMeTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      sendTyping(true); // peer notified only on false→true
      typingTimer.current = setTimeout(() => {
        setMeTyping(false);
        sendTyping(false);
      }, 2000);
    } else {
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
        typingTimer.current = null;
      }
      setMeTyping(false);
      sendTyping(false);
    }
  }, []);

  const leaveRoom = useCallback(() => {
    intentionalClose.current = true;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    clearBurnTimers();
    if (typingTimer.current) clearTimeout(typingTimer.current);
    const rid = roomIdRef.current;
    clearRoomSession(rid);
    clearRoomKeyPair(rid);
    try {
      wsRef.current?.close(1000, "leave");
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    keyPairRef.current = null;
    sharedKeyRef.current = null;
    setPeerId(null);
    setPeerTyping(false);
    setMeTyping(false);
    setMessages([]);
    setSafetyNumber(null);
    setError(null);
    setState("closed");
  }, [clearBurnTimers]);

  return {
    state,
    myId,
    peerId,
    peerTyping,
    meTyping,
    messages,
    ttlMode,
    setTtlMode,
    error,
    safetyNumber,
    sendMessage,
    notifyTyping,
    leaveRoom,
    // ready implies shared key was established in join handlers
    canSend: state === "ready",
  };
}
