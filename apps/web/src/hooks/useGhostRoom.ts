"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMlsSession,
  bootstrapGroup,
  exportKeyPackage,
  addMember,
  acceptWelcome,
  processCommit,
  removeMember,
  encryptApp,
  decryptApp,
  epochSafetyNumber,
  hasMlsGroup,
  MLS_NONCE_MARKER,
  type MlsSession,
} from "@ghostchat/crypto";
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
  type PeerInfo,
} from "@ghostchat/protocol";
import { generateMessageId, parseTtlMs, type TtlMode } from "@ghostchat/shared";
import { getWsUrl } from "@/lib/config";
import {
  clearCachedMlsSession,
  getCachedMlsSession,
  setCachedMlsSession,
} from "@/lib/mlsSession";
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
/** Re-broadcast KeyPackage while waiting for Welcome. */
const KP_RETRY_MS = [300, 1200, 2800, 5500, 9000] as const;

/**
 * Elect committer among members already in the MLS group.
 * Pending KeyPackage peers are NOT candidates (they are still joining) —
 * otherwise a smaller-id joiner deadlocks the creator who holds the group.
 */
function isCommitter(
  myId: string,
  memberIds: string[],
  hasGroup: boolean,
  pendingJoiners: Iterable<string> = []
): boolean {
  if (!hasGroup || !myId) return false;
  const pending = new Set(pendingJoiners);
  const candidates = [
    myId,
    ...memberIds.filter((id) => id !== myId && !pending.has(id)),
  ].sort();
  return candidates[0] === myId;
}

export function useGhostRoom({ roomId, defaultTtl = "60s" }: Options) {
  const [state, setState] = useState<RoomConnectionState>("connecting");
  const [myId, setMyId] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [maxParticipants, setMaxParticipants] = useState(2);
  const [participantCount, setParticipantCount] = useState(0);
  const [typingPeers, setTypingPeers] = useState<string[]>([]);
  const [meTyping, setMeTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ttlMode, setTtlMode] = useState<TtlMode>(defaultTtl);
  const [error, setError] = useState<string | null>(null);
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mlsRef = useRef<MlsSession | null>(null);
  const membersRef = useRef<RoomMember[]>([]);
  const roomIdRef = useRef(roomId);
  const intentionalClose = useRef(false);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burnTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kpRetryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Pending key packages from peers we have not added yet. */
  const pendingKp = useRef<Map<string, string>>(new Map());
  /** Avoid double-add races. */
  const addingPeer = useRef<Set<string>>(new Set());
  const removingPeer = useRef<Set<string>>(new Set());
  /** Serialize MLS ops so concurrent decrypt/commit/encrypt cannot race epoch. */
  const mlsQueue = useRef(Promise.resolve());
  const ttlModeRef = useRef(ttlMode);
  const myIdRef = useRef(myId);
  const lastTypingSent = useRef(false);

  roomIdRef.current = roomId;
  ttlModeRef.current = ttlMode;
  myIdRef.current = myId;
  membersRef.current = members;

  const enqueueMls = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const next = mlsQueue.current.then(fn, fn);
    // Keep queue alive after failures
    mlsQueue.current = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }, []);

  const clearBurnTimers = useCallback(() => {
    burnTimers.current.forEach((t) => clearTimeout(t));
    burnTimers.current.clear();
  }, []);

  const clearKpRetries = useCallback(() => {
    kpRetryTimers.current.forEach(clearTimeout);
    kpRetryTimers.current = [];
  }, []);

  const persistMls = useCallback((session: MlsSession | null) => {
    mlsRef.current = session;
    const rid = roomIdRef.current;
    if (session) {
      setCachedMlsSession(rid, session);
      setSafetyNumber(epochSafetyNumber(session));
    } else {
      setSafetyNumber(null);
    }
  }, []);

  const sendJson = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }, []);

  const broadcastKeyPackage = useCallback(() => {
    const session = mlsRef.current;
    if (!session || session.state) return; // only joiners without group
    const pkg = exportKeyPackage(session);
    sendJson({
      v: PROTOCOL_VERSION,
      type: "mls_key_package",
      package: pkg,
    });
  }, [sendJson]);

  const scheduleKeyPackageRetries = useCallback(() => {
    clearKpRetries();
    if (hasMlsGroup(mlsRef.current)) return;
    for (const delay of KP_RETRY_MS) {
      const t = setTimeout(() => {
        if (!hasMlsGroup(mlsRef.current)) broadcastKeyPackage();
      }, delay);
      kpRetryTimers.current.push(t);
    }
  }, [broadcastKeyPackage, clearKpRetries]);

  const tryAddPending = useCallback(async () => {
    return enqueueMls(async () => {
      const my = myIdRef.current;
      if (!mlsRef.current?.state || !my) return;
      if (
        !isCommitter(
          my,
          membersRef.current.map((m) => m.id),
          true,
          pendingKp.current.keys()
        )
      ) {
        return;
      }

      for (const [peerId, pkg] of [...pendingKp.current.entries()]) {
        // Re-read latest state each iteration (epoch advances after each add)
        const session = mlsRef.current;
        if (!session?.state) return;
        if (addingPeer.current.has(peerId)) continue;
        if (peerId === my) continue;
        addingPeer.current.add(peerId);
        try {
          const result = await addMember(session, pkg);
          persistMls(result.session);
          pendingKp.current.delete(peerId);
          sendJson({
            v: PROTOCOL_VERSION,
            type: "mls_welcome",
            to: peerId,
            welcome: result.welcomeB64,
          });
          sendJson({
            v: PROTOCOL_VERSION,
            type: "mls_commit",
            commit: result.commitB64,
          });
          setState("ready");
          setError(null);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Failed to add peer to MLS group"
          );
        } finally {
          addingPeer.current.delete(peerId);
        }
      }
    });
  }, [enqueueMls, persistMls, sendJson]);

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

    switch (msg.type) {
      case "joined": {
        void (async () => {
          setMyId(msg.yourId);
          setError(null);
          if (msg.sessionToken) sessionSet(`session:${rid}`, msg.sessionToken);
          if (msg.yourId) sessionSet(`display:${rid}`, msg.yourId);
          setMaxParticipants(msg.maxParticipants ?? 2);
          setParticipantCount(msg.participantCount ?? 1);

          const peers: RoomMember[] =
            msg.peers?.map((p: PeerInfo) => ({
              id: p.id,
              publicKey: p.publicKey || "mls",
            })) ??
            (msg.peerId
              ? [{ id: msg.peerId, publicKey: msg.peerPublicKey || "mls" }]
              : []);
          setMembers(peers);

          let session =
            getCachedMlsSession(rid) ??
            mlsRef.current ??
            (await createMlsSession(msg.yourId, rid));

          // Identity must match assigned display id
          if (session.identity !== msg.yourId || session.groupId !== rid) {
            session = await createMlsSession(msg.yourId, rid);
          }

          if (session.state) {
            // Restored group from cache
            persistMls(session);
            setState(peers.length > 0 ? "ready" : "waiting_peer");
            // Still try to add any pending / process after KP from others
            void tryAddPending();
          } else if (peers.length === 0) {
            session = await bootstrapGroup(session);
            persistMls(session);
            setState("waiting_peer");
          } else {
            persistMls(session);
            setState("waiting_peer");
            broadcastKeyPackage();
            scheduleKeyPackageRetries();
          }
        })();
        break;
      }
      case "peer_joined": {
        if (!msg.peerId) break;
        const peer: RoomMember = {
          id: msg.peerId,
          publicKey: msg.peerPublicKey || "mls",
        };
        setMembers((prev) => {
          if (prev.some((m) => m.id === peer.id)) return prev;
          return [...prev, peer];
        });
        setParticipantCount(msg.participantCount ?? 0);
        setError(null);
        // Wait for their KeyPackage; tryAddPending when it arrives
        break;
      }
      case "peer_left": {
        const leftId = msg.peerId;
        setMembers((prev) => {
          const next = prev.filter((m) => m.id !== leftId);
          if (next.length === 0) setState("waiting_peer");
          return next;
        });
        setParticipantCount(msg.participantCount ?? 0);
        setTypingPeers((prev) => prev.filter((id) => id !== leftId));
        pendingKp.current.delete(leftId);

        void enqueueMls(async () => {
          const session = mlsRef.current;
          const my = myIdRef.current;
          if (!session?.state || !my || !leftId) return;
          if (removingPeer.current.has(leftId)) return;
          const membersLeft = membersRef.current
            .map((m) => m.id)
            .filter((id) => id !== leftId);
          if (
            !isCommitter(my, membersLeft, true, pendingKp.current.keys())
          ) {
            return;
          }
          removingPeer.current.add(leftId);
          try {
            const rem = await removeMember(session, leftId);
            if (rem) {
              persistMls(rem.session);
              sendJson({
                v: PROTOCOL_VERSION,
                type: "mls_commit",
                commit: rem.commitB64,
              });
            }
          } catch {
            /* ignore remove races */
          } finally {
            removingPeer.current.delete(leftId);
          }
        });
        break;
      }
      case "mls_key_package": {
        if (!msg.from || msg.from === myIdRef.current) break;
        pendingKp.current.set(msg.from, msg.package);
        void tryAddPending();
        break;
      }
      case "mls_welcome": {
        void enqueueMls(async () => {
          if (msg.to !== myIdRef.current) return;
          if (hasMlsGroup(mlsRef.current)) return;
          try {
            let session = mlsRef.current;
            if (!session) {
              session = await createMlsSession(myIdRef.current!, rid);
            }
            session = await acceptWelcome(session, msg.welcome);
            persistMls(session);
            clearKpRetries();
            setState("ready");
            setError(null);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Failed to accept MLS welcome"
            );
          }
        }).then(() => {
          void tryAddPending();
        });
        break;
      }
      case "mls_commit": {
        void enqueueMls(async () => {
          if (msg.from === myIdRef.current) return;
          const session = mlsRef.current;
          if (!session?.state) return;
          try {
            const next = await processCommit(session, msg.commit);
            persistMls(next);
            if (membersRef.current.length > 0) {
              setState("ready");
            }
            setError(null);
          } catch {
            // Epoch desync — joiner can re-broadcast KP; members stay on last epoch
            setError("MLS commit failed (epoch?)");
          }
        }).then(() => {
          void tryAddPending();
        });
        break;
      }
      case "message": {
        void enqueueMls(async () => {
          const session = mlsRef.current;
          if (!session?.state) {
            setError("Received message but MLS group not ready");
            return;
          }
          try {
            const result = await decryptApp(session, msg.ciphertext);
            persistMls(result.session);
            if (!result.text) return;
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.messageId)) return prev;
              return [
                ...prev,
                {
                  id: msg.messageId,
                  from: msg.from,
                  text: result.text,
                  mine: false,
                  ttlMode: msg.ttlMode,
                  receivedAt: Date.now(),
                },
              ];
            });
            scheduleTtl(msg.messageId, msg.ttlMode, false);
            setTypingPeers((prev) => prev.filter((id) => id !== msg.from));
          } catch {
            setError("Failed to decrypt MLS message");
          }
        });
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
        clearCachedMlsSession(rid);
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
    setParticipantCount(0);
    setTypingPeers([]);
    setMeTyping(false);
    setMessages([]);
    setSafetyNumber(null);
    clearKpRetries();
    pendingKp.current.clear();
    addingPeer.current.clear();

    const cached = getCachedMlsSession(roomId);
    mlsRef.current = cached;
    if (cached) setSafetyNumber(epochSafetyNumber(cached));

    const displayId = getOrCreateDisplayId(roomId);
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
            publicKey: "mls",
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
      clearKpRetries();
      if (typingTimer.current) clearTimeout(typingTimer.current);
      try {
        wsRef.current?.close(1000, "remount");
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      // Keep MLS cache across Strict Mode remount
      mlsRef.current = null;
    };
  }, [roomId, clearBurnTimers, clearKpRetries]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const ws = wsRef.current;

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("Not connected — wait a moment or refresh");
        return false;
      }
      if (!mlsRef.current?.state) {
        setError("Encryption not ready — waiting for MLS group");
        return false;
      }
      if (membersRef.current.length === 0) {
        setError("Waiting for at least one peer to join");
        return false;
      }

      try {
        return await enqueueMls(async () => {
          const session = mlsRef.current;
          if (!session?.state || !wsRef.current) return false;
          const messageId = generateMessageId();
          const mode = ttlModeRef.current;
          const enc = await encryptApp(session, trimmed);
          persistMls(enc.session);
          wsRef.current.send(
            JSON.stringify({
              v: PROTOCOL_VERSION,
              type: "message",
              ciphertext: enc.ciphertextB64,
              nonce: MLS_NONCE_MARKER,
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
          wsRef.current.send(
            JSON.stringify({
              v: PROTOCOL_VERSION,
              type: "typing",
              state: false,
            })
          );
          setError(null);
          return true;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send");
        return false;
      }
    },
    [scheduleTtl, persistMls, enqueueMls]
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
    clearKpRetries();
    if (typingTimer.current) clearTimeout(typingTimer.current);
    const rid = roomIdRef.current;
    clearRoomSession(rid);
    clearCachedMlsSession(rid);
    try {
      wsRef.current?.close(1000, "leave");
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    mlsRef.current = null;
    setMembers([]);
    setTypingPeers([]);
    setMeTyping(false);
    setMessages([]);
    setSafetyNumber(null);
    setError(null);
    setState("closed");
  }, [clearBurnTimers, clearKpRetries]);

  const canSendUi =
    !!safetyNumber &&
    members.length > 0 &&
    state !== "error" &&
    state !== "closed" &&
    state !== "connecting";

  const displayState: RoomConnectionState =
    canSendUi && state === "waiting_peer" ? "ready" : state;

  const peerId =
    typingPeers[0] ?? (members.length === 1 ? members[0]!.id : null);

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
    typingPeers,
    peerTyping: typingPeers.length > 0,
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
