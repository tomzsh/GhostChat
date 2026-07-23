"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decryptFromWire,
  encryptToWire,
  generateRoomKey,
  wrapRoomKeyForPeer,
  unwrapRoomKeyFromPeer,
  publicKeyToBase64,
  publicKeyFromBase64,
  safetyNumberFromKey,
  type KeyPair,
} from "@ghostchat/crypto";
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
  type PeerInfo,
} from "@ghostchat/protocol";
import { generateMessageId, parseTtlMs, type TtlMode } from "@ghostchat/shared";
import { getWsUrl } from "@/lib/config";
import { clearRoomKeyPair, getOrCreateRoomKeyPair } from "@/lib/keys";
import {
  clearCachedRoomKey,
  getCachedRoomKey,
  setCachedRoomKey,
} from "@/lib/roomKey";
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

export type RoomMember = {
  id: string;
  publicKey: string;
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
/** Delays (ms) to re-send key_share to a peer after join. */
const KEY_SHARE_RETRY_MS = [0, 600, 1800, 4000] as const;
/** Delays (ms) to broadcast key_request while waiting for room key. */
const KEY_REQUEST_RETRY_MS = [400, 1200, 2800, 5500, 9000] as const;

export function useGhostRoom({ roomId, defaultTtl = "60s" }: Options) {
  const [state, setState] = useState<RoomConnectionState>("connecting");
  const [myId, setMyId] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [maxParticipants, setMaxParticipants] = useState(2);
  const [participantCount, setParticipantCount] = useState(0);
  /** Peer ids currently typing (group-safe multi-typing). */
  const [typingPeers, setTypingPeers] = useState<string[]>([]);
  const [meTyping, setMeTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ttlMode, setTtlMode] = useState<TtlMode>(defaultTtl);
  const [error, setError] = useState<string | null>(null);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const keyPairRef = useRef<KeyPair | null>(null);
  /** Group room AEAD key (shared by all members). */
  const roomKeyRef = useRef<Uint8Array | null>(null);
  const membersRef = useRef<RoomMember[]>([]);
  /** Immediate map of peerId → publicKey (avoids setState race on key_share). */
  const peerPubMapRef = useRef<Map<string, string>>(new Map());
  const roomIdRef = useRef(roomId);
  const intentionalClose = useRef(false);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burnTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Timers for key_share retries per peer id. */
  const keyShareTimers = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(
    new Map()
  );
  /** Timers for key_request while waiting for room key. */
  const keyRequestTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ttlModeRef = useRef(ttlMode);
  const myIdRef = useRef(myId);
  const stateRef = useRef(state);
  const lastTypingSent = useRef(false);

  roomIdRef.current = roomId;
  ttlModeRef.current = ttlMode;
  myIdRef.current = myId;
  stateRef.current = state;
  membersRef.current = members;

  const clearBurnTimers = useCallback(() => {
    burnTimers.current.forEach((t) => clearTimeout(t));
    burnTimers.current.clear();
  }, []);

  const clearKeyShareTimers = useCallback((peerId?: string) => {
    if (peerId) {
      const list = keyShareTimers.current.get(peerId);
      if (list) {
        list.forEach(clearTimeout);
        keyShareTimers.current.delete(peerId);
      }
      return;
    }
    keyShareTimers.current.forEach((list) => list.forEach(clearTimeout));
    keyShareTimers.current.clear();
  }, []);

  const clearKeyRequestTimers = useCallback(() => {
    keyRequestTimers.current.forEach(clearTimeout);
    keyRequestTimers.current = [];
  }, []);

  const setRoomKey = useCallback(
    (key: Uint8Array | null, rid?: string) => {
      const id = rid ?? roomIdRef.current;
      roomKeyRef.current = key;
      if (key) {
        setCachedRoomKey(id, key);
        setSafetyNumber(safetyNumberFromKey(key));
        // Stop asking others for the key once we have it
        clearKeyRequestTimers();
      } else {
        setSafetyNumber(null);
      }
    },
    [clearKeyRequestTimers]
  );

  const shareKeyWithPeer = useCallback(
    (peer: RoomMember) => {
      const ws = wsRef.current;
      const kp = keyPairRef.current;
      const roomKey = roomKeyRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !kp || !roomKey) return;
      try {
        const wire = wrapRoomKeyForPeer(
          kp.privateKey,
          publicKeyFromBase64(peer.publicKey),
          roomKey,
          roomIdRef.current
        );
        ws.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "key_share",
            to: peer.id,
            ciphertext: wire.ciphertext,
            nonce: wire.nonce,
          })
        );
      } catch {
        /* ignore wrap errors */
      }
    },
    []
  );

  /** Share room key immediately + retry a few times (peer may not be ready). */
  const shareKeyWithPeerRetry = useCallback(
    (peer: RoomMember) => {
      clearKeyShareTimers(peer.id);
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (const delay of KEY_SHARE_RETRY_MS) {
        const t = setTimeout(() => {
          if (!roomKeyRef.current) return;
          // Peer may have left
          if (!peerPubMapRef.current.has(peer.id)) return;
          shareKeyWithPeer(peer);
        }, delay);
        timers.push(t);
      }
      keyShareTimers.current.set(peer.id, timers);
    },
    [clearKeyShareTimers, shareKeyWithPeer]
  );

  /** Ask members who already have the key to re-send key_share. */
  const requestRoomKey = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (roomKeyRef.current) return;
    ws.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "key_request",
      })
    );
  }, []);

  const scheduleKeyRequests = useCallback(() => {
    clearKeyRequestTimers();
    if (roomKeyRef.current) return;
    for (const delay of KEY_REQUEST_RETRY_MS) {
      const t = setTimeout(() => {
        if (!roomKeyRef.current) requestRoomKey();
      }, delay);
      keyRequestTimers.current.push(t);
    }
  }, [clearKeyRequestTimers, requestRoomKey]);

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

  const onServerRef = useRef<(msg: ServerMessage) => void>(() => {});
  onServerRef.current = (msg: ServerMessage) => {
    const rid = roomIdRef.current;
    const kp = keyPairRef.current;

    switch (msg.type) {
      case "joined": {
        setMyId(msg.yourId);
        setError(null);
        if (msg.sessionToken) sessionSet(`session:${rid}`, msg.sessionToken);
        if (msg.yourId) sessionSet(`display:${rid}`, msg.yourId);
        setMaxParticipants(msg.maxParticipants ?? 2);
        setParticipantCount(msg.participantCount ?? 1);

        const peers: RoomMember[] =
          msg.peers?.map((p: PeerInfo) => ({
            id: p.id,
            publicKey: p.publicKey,
          })) ??
          (msg.peerId && msg.peerPublicKey
            ? [{ id: msg.peerId, publicKey: msg.peerPublicKey }]
            : []);

        const map = new Map<string, string>();
        for (const p of peers) map.set(p.id, p.publicKey);
        peerPubMapRef.current = map;
        setMembers(peers);

        // Restore room key from tab cache (Strict Mode / soft remount)
        const cached = getCachedRoomKey(rid);
        if (cached) {
          setRoomKey(cached, rid);
          for (const p of peers) shareKeyWithPeerRetry(p);
          setState(peers.length > 0 ? "ready" : "waiting_peer");
        } else if (peers.length === 0) {
          // First occupant — mint group room key
          setRoomKey(generateRoomKey(), rid);
          setState("waiting_peer");
        } else {
          // Wait for key_share; also proactively request it (retry)
          setState("waiting_peer");
          setError(null);
          scheduleKeyRequests();
        }
        break;
      }
      case "peer_joined": {
        if (!msg.peerPublicKey || !msg.peerId) break;
        const peer: RoomMember = {
          id: msg.peerId,
          publicKey: msg.peerPublicKey,
        };
        peerPubMapRef.current.set(peer.id, peer.publicKey);
        setMembers((prev) => {
          if (prev.some((m) => m.id === peer.id)) return prev;
          return [...prev, peer];
        });
        setParticipantCount(msg.participantCount ?? 0);
        // Share our room key with the newcomer (if we have it) + retries
        if (roomKeyRef.current) {
          shareKeyWithPeerRetry(peer);
          setState("ready");
        } else {
          // Try cache again (remount race)
          const cached = getCachedRoomKey(rid);
          if (cached) {
            setRoomKey(cached, rid);
            shareKeyWithPeerRetry(peer);
            setState("ready");
          } else if (membersRef.current.length > 0 || peer) {
            // Still waiting for key — ensure requests are scheduled
            scheduleKeyRequests();
          }
        }
        setError(null);
        break;
      }
      case "peer_left": {
        const leftId = msg.peerId;
        peerPubMapRef.current.delete(leftId);
        clearKeyShareTimers(leftId);
        setMembers((prev) => {
          const next = prev.filter((m) => m.id !== leftId);
          if (next.length === 0) setState("waiting_peer");
          return next;
        });
        setParticipantCount(msg.participantCount ?? 0);
        setTypingPeers((prev) => prev.filter((id) => id !== leftId));
        // Keep room key for remaining members
        break;
      }
      case "key_share": {
        if (!kp || msg.to !== myIdRef.current) break;
        if (roomKeyRef.current) break; // already have key
        try {
          const senderPk = peerPubMapRef.current.get(msg.from);
          if (!senderPk) break;
          const key = unwrapRoomKeyFromPeer(
            kp.privateKey,
            publicKeyFromBase64(senderPk),
            msg.ciphertext,
            msg.nonce,
            rid
          );
          setRoomKey(key, rid);
          setState("ready");
          setError(null);
          // One-shot mesh to other known peers (they can key_request if still missing)
          for (const [id, publicKey] of peerPubMapRef.current) {
            if (id === msg.from) continue;
            shareKeyWithPeer({ id, publicKey });
          }
        } catch {
          setError("Failed to unwrap room key");
        }
        break;
      }
      case "key_request": {
        // Requester already schedules retries — reply once (avoid N×retry storms)
        if (!roomKeyRef.current || !msg.from) break;
        const pk = peerPubMapRef.current.get(msg.from);
        if (!pk) break;
        shareKeyWithPeer({ id: msg.from, publicKey: pk });
        break;
      }
      case "message": {
        if (!roomKeyRef.current) {
          setError("Received message but no room key yet");
          break;
        }
        try {
          const text = decryptFromWire(
            roomKeyRef.current,
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
          // Only clear typing indicator for the sender
          setTypingPeers((prev) => prev.filter((id) => id !== msg.from));
        } catch {
          setError("Failed to decrypt a message (key mismatch?)");
        }
        break;
      }
      case "typing":
        setTypingPeers((prev) => {
          if (msg.state) {
            if (prev.includes(msg.from)) return prev;
            return [...prev, msg.from];
          }
          return prev.filter((id) => id !== msg.from);
        });
        break;
      case "burn":
        burnMessage(msg.messageId, false);
        break;
      case "error": {
        const label =
          msg.code === "room_not_found"
            ? "Room not found or already destroyed"
            : msg.code === "room_full"
              ? msg.message ?? "Room is full"
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
        clearCachedRoomKey(rid);
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
    setMembers([]);
    peerPubMapRef.current = new Map();
    setParticipantCount(0);
    setTypingPeers([]);
    setMeTyping(false);
    setMessages([]);
    setSafetyNumber(null);
    clearKeyShareTimers();
    clearKeyRequestTimers();
    // Keep tab cache; restore on re-join. Only clear ref for this mount.
    roomKeyRef.current = getCachedRoomKey(roomId);

    const kp = getOrCreateRoomKeyPair(roomId);
    keyPairRef.current = kp;
    const displayId = getOrCreateDisplayId(roomId);
    const sessionToken = getOrCreateSessionToken(roomId);
    setMyId(displayId);

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
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
          /* ignore */
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
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer) clearInterval(pingTimer);
      clearBurnTimers();
      clearKeyShareTimers();
      clearKeyRequestTimers();
      if (typingTimer.current) clearTimeout(typingTimer.current);
      try {
        wsRef.current?.close(1000, "remount");
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      // Do not clear room key cache here (Strict Mode remount needs it)
      roomKeyRef.current = null;
    };
  }, [
    roomId,
    clearBurnTimers,
    clearKeyShareTimers,
    clearKeyRequestTimers,
  ]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const ws = wsRef.current;
      const key = roomKeyRef.current;

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("Not connected — wait a moment or refresh");
        return false;
      }
      if (!key) {
        setError("Encryption not ready — waiting for room key");
        return false;
      }
      if (membersRef.current.length === 0) {
        setError("Waiting for at least one peer to join");
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
        lastTypingSent.current = false;
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

  const notifyTyping = useCallback((isTyping: boolean) => {
    const sendTyping = (s: boolean) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;
      if (s === lastTypingSent.current) return;
      lastTypingSent.current = s;
      wsRef.current.send(
        JSON.stringify({ v: PROTOCOL_VERSION, type: "typing", state: s })
      );
    };

    if (isTyping) {
      setMeTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      sendTyping(true);
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
    clearKeyShareTimers();
    clearKeyRequestTimers();
    if (typingTimer.current) clearTimeout(typingTimer.current);
    const rid = roomIdRef.current;
    clearRoomSession(rid);
    clearRoomKeyPair(rid);
    clearCachedRoomKey(rid);
    try {
      wsRef.current?.close(1000, "leave");
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    keyPairRef.current = null;
    roomKeyRef.current = null;
    setMembers([]);
    setTypingPeers([]);
    setMeTyping(false);
    setMessages([]);
    setSafetyNumber(null);
    setError(null);
    setState("closed");
  }, [clearBurnTimers, clearKeyShareTimers, clearKeyRequestTimers]);

  // Have room key (safety number) + at least one other member
  const canSendUi =
    !!safetyNumber &&
    members.length > 0 &&
    state !== "error" &&
    state !== "closed" &&
    state !== "connecting";

  const displayState: RoomConnectionState =
    canSendUi && state === "waiting_peer" ? "ready" : state;

  /** Primary peer for 1:1 UI (first typing peer, else sole member). */
  const peerId =
    typingPeers[0] ?? (members.length === 1 ? members[0]!.id : null);
  const peerTyping = typingPeers.length > 0;

  return {
    state: displayState,
    myId,
    peerId,
    members,
    maxParticipants,
    participantCount: Math.max(
      participantCount,
      members.length + (myId ? 1 : 0)
    ),
    /** Ids of peers currently typing (0..n). Prefer this over peerTyping for groups. */
    typingPeers,
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
    canSend: canSendUi,
  };
}
