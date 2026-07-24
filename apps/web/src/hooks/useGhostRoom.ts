"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMlsSession,
  bootstrapGroup,
  exportKeyPackage,
  addMember,
  acceptWelcome,
  processCommitIfNeeded,
  removeMember,
  encryptApp,
  decryptApp,
  epochSafetyNumber,
  hasMlsGroup,
  findLeafIndex,
  MLS_NONCE_MARKER,
  type MlsSession,
} from "@ghostchat/crypto";
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
  type PeerInfo,
} from "@ghostchat/protocol";
import {
  decodeAppPayload,
  encodeAppEmoji,
  encodeAppImageChunks,
  generateMessageId,
  ImageTransferAssembler,
  isOnLeaveTtl,
  isValidRoomId,
  LIMITS,
  normalizeRoomId,
  parseTtlMs,
  type AsciiEmojiId,
  type TtlMode,
} from "@ghostchat/shared";
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
  migrateRoomIdentity,
  rememberWsInternal,
  resolveWsInternal,
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
  kind?: "text" | "image" | "emoji";
  /** Object URL for decrypted/local image (revoke on burn). */
  imageUrl?: string;
  imageName?: string;
  imageMime?: string;
  /** Animated ASCII emote id */
  emojiId?: string;
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
  /** Public invite code (rotates when someone leaves). */
  const [publicCode, setPublicCode] = useState(() => normalizeRoomId(roomId));

  const wsRef = useRef<WebSocket | null>(null);
  const mlsRef = useRef<MlsSession | null>(null);
  const membersRef = useRef<RoomMember[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  /**
   * Stable WS / session key = durable object internal id.
   * Starts as URL code (or mapped internal after prior rotation); upgraded to
   * server `internalId` on joined so later reconnects survive invite rotation.
   */
  const joinIdRef = useRef(resolveWsInternal(roomId));
  const roomIdRef = useRef(joinIdRef.current);
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
  /** Reassemble multi-frame E2EE image transfers. */
  const imageAssembler = useRef(new ImageTransferAssembler());

  // Keep refs in sync — roomIdRef stays on join key (not rotated public code)
  roomIdRef.current = joinIdRef.current;
  ttlModeRef.current = ttlMode;
  myIdRef.current = myId;
  membersRef.current = members;
  messagesRef.current = messages;

  const applyPublicCode = useCallback((code: string) => {
    const next = normalizeRoomId(code);
    if (!next || !isValidRoomId(next)) return;
    // Bind new public code → stable internal WS id for remount recovery
    rememberWsInternal(next, joinIdRef.current);
    setPublicCode((prev) => (prev === next ? prev : next));
    // Soft URL update for shareability. WS stays on joinIdRef (internal id).
    if (typeof window !== "undefined") {
      try {
        const path = `/r/${next}`;
        if (window.location.pathname !== path) {
          window.history.replaceState(null, "", path);
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

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
        // Already in MLS tree (e.g. KP retry after successful Welcome)
        if (findLeafIndex(session, peerId) !== null) {
          pendingKp.current.delete(peerId);
          continue;
        }
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
          const msg =
            e instanceof Error ? e.message : "Failed to add peer to MLS group";
          // Duplicate add / already member — drop pending, don't scare the UI
          if (/already|duplicate|exist/i.test(msg)) {
            pendingKp.current.delete(peerId);
          } else {
            setError(msg);
          }
        } finally {
          addingPeer.current.delete(peerId);
        }
      }
    });
  }, [enqueueMls, persistMls, sendJson]);

  const revokeImageUrls = useCallback((msgs: ChatMessage[]) => {
    for (const m of msgs) {
      if (m.imageUrl) {
        try {
          URL.revokeObjectURL(m.imageUrl);
        } catch {
          /* ignore */
        }
      }
    }
  }, []);

  const burnMessage = useCallback(
    (messageId: string, notifyPeer: boolean) => {
      setMessages((prev) => {
        if (!prev.some((m) => m.id === messageId)) return prev;
        return prev.map((m) =>
          m.id === messageId ? { ...m, burning: true } : m
        );
      });
      setTimeout(() => {
        setMessages((prev) => {
          const doomed = prev.filter((m) => m.id === messageId);
          revokeImageUrls(doomed);
          return prev.filter((m) => m.id !== messageId);
        });
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
    },
    [revokeImageUrls]
  );

  /** Burn all local messages (leave room / room closed). */
  const burnAllMessages = useCallback(() => {
    clearBurnTimers();
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((m) => ({ ...m, burning: true }));
    });
    setTimeout(() => {
      setMessages((prev) => {
        revokeImageUrls(prev);
        return [];
      });
    }, 450);
  }, [clearBurnTimers, revokeImageUrls]);

  /**
   * Burn messages with burn mode `on_leave` from a specific sender
   * (when that user leaves the room). Timed / on_read messages are unchanged.
   * Side effects stay outside setState (Strict Mode safe).
   */
  const scheduleTtl = useCallback(
    (messageId: string, mode: TtlMode, mine: boolean) => {
      // Keep until sender leaves — no clock / on-read autodelete
      if (isOnLeaveTtl(mode)) return;
      if (mode === "on_read") {
        if (!mine) {
          const t = setTimeout(() => burnMessage(messageId, true), 2500);
          burnTimers.current.set(messageId, t);
        }
        return;
      }
      const ms = parseTtlMs(mode);
      if (ms === null) return;
      const t = setTimeout(() => burnMessage(messageId, !mine), ms);
      burnTimers.current.set(messageId, t);
    },
    [burnMessage]
  );

  const burnOnLeaveMessagesFrom = useCallback(
    (senderId: string) => {
      if (!senderId) return;
      const prev = messagesRef.current;
      const targets = prev.filter(
        (m) => m.from === senderId && isOnLeaveTtl(m.ttlMode) && !m.burning
      );
      if (targets.length === 0) return;
      const ids = new Set(targets.map((m) => m.id));
      for (const id of ids) {
        const t = burnTimers.current.get(id);
        if (t) {
          clearTimeout(t);
          burnTimers.current.delete(id);
        }
      }
      setMessages((cur) =>
        cur.map((m) => (ids.has(m.id) ? { ...m, burning: true } : m))
      );
      setTimeout(() => {
        setMessages((cur) => {
          const doomed = cur.filter((m) => ids.has(m.id));
          revokeImageUrls(doomed);
          return cur.filter((m) => !ids.has(m.id));
        });
      }, 450);
    },
    [revokeImageUrls]
  );

  const appendImageMessage = useCallback(
    (
      meta: {
        id: string;
        from: string;
        mine: boolean;
        ttlMode: TtlMode;
      },
      image: { mime: string; name: string; bytes: Uint8Array }
    ) => {
      const blob = new Blob([image.bytes as BlobPart], { type: image.mime });
      const imageUrl = URL.createObjectURL(blob);
      const msg: ChatMessage = {
        id: meta.id,
        from: meta.from,
        text: "",
        mine: meta.mine,
        ttlMode: meta.ttlMode,
        receivedAt: Date.now(),
        kind: "image",
        imageUrl,
        imageName: image.name,
        imageMime: image.mime,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === meta.id)) {
          URL.revokeObjectURL(imageUrl);
          return prev;
        }
        return [...prev, msg];
      });
      scheduleTtl(meta.id, meta.ttlMode, meta.mine);
    },
    [scheduleTtl]
  );

  const appendChatMessage = useCallback(
    (
      rawText: string,
      meta: {
        id: string;
        from: string;
        mine: boolean;
        ttlMode: TtlMode;
      }
    ) => {
      const parsed = decodeAppPayload(rawText);
      // Chunks are assembled separately — never show partial frames as text
      if (parsed.kind === "image_part") return;
      let msg: ChatMessage;
      if (parsed.kind === "image") {
        appendImageMessage(meta, parsed);
        return;
      } else if (parsed.kind === "emoji") {
        msg = {
          id: meta.id,
          from: meta.from,
          text: `:${parsed.id}:`,
          mine: meta.mine,
          ttlMode: meta.ttlMode,
          receivedAt: Date.now(),
          kind: "emoji",
          emojiId: parsed.id,
        };
      } else {
        msg = {
          id: meta.id,
          from: meta.from,
          text: parsed.text,
          mine: meta.mine,
          ttlMode: meta.ttlMode,
          receivedAt: Date.now(),
          kind: "text",
        };
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === meta.id)) return prev;
        return [...prev, msg];
      });
      scheduleTtl(meta.id, meta.ttlMode, meta.mine);
    },
    [scheduleTtl, appendImageMessage]
  );

  const onServerRef = useRef<(msg: ServerMessage) => void>(() => {});
  onServerRef.current = (msg: ServerMessage) => {
    const rid = roomIdRef.current;

    switch (msg.type) {
      case "joined": {
        // Lock WS to durable internal id so reconnect works after invite rotation
        const prevKey = rid;
        const internalRaw = String(msg.internalId ?? "").trim();
        const internal = normalizeRoomId(internalRaw);
        if (internal && isValidRoomId(internal) && internal !== prevKey) {
          migrateRoomIdentity(prevKey, internal);
          joinIdRef.current = internal;
          roomIdRef.current = internal;
          // Move MLS cache key to internal id
          const cachedMls = getCachedMlsSession(prevKey) ?? mlsRef.current;
          if (cachedMls) {
            setCachedMlsSession(internal, cachedMls);
            clearCachedMlsSession(prevKey);
          }
        } else if (internal && isValidRoomId(internal)) {
          joinIdRef.current = internal;
          roomIdRef.current = internal;
          rememberWsInternal(internal, internal);
        }
        // Prefer server public invite code (may already be rotated)
        if (msg.publicCode) applyPublicCode(String(msg.publicCode));
        else rememberWsInternal(prevKey, joinIdRef.current);

        const sid = joinIdRef.current;
        // Keep MLS bootstrap on the same queue as commits/encrypt
        void enqueueMls(async () => {
          setMyId(msg.yourId);
          myIdRef.current = msg.yourId;
          setError(null);
          if (msg.sessionToken) sessionSet(`session:${sid}`, msg.sessionToken);
          if (msg.yourId) sessionSet(`display:${sid}`, msg.yourId);
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
          // Sync ref immediately — setState is async and tryAddPending reads membersRef
          membersRef.current = peers;
          setMembers(peers);

          let session =
            getCachedMlsSession(sid) ??
            mlsRef.current ??
            (await createMlsSession(msg.yourId, sid));

          // Identity must match assigned display id
          if (session.identity !== msg.yourId || session.groupId !== sid) {
            session = await createMlsSession(msg.yourId, sid);
          }

          if (session.state) {
            // Restored group from cache
            persistMls(session);
            setState(peers.length > 0 ? "ready" : "waiting_peer");
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
          // KP may have arrived while bootstrap ran — drain pending adds
          // (nested enqueue is fine; runs after this job)
          void tryAddPending();
        });
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
          const next = [...prev, peer];
          membersRef.current = next;
          return next;
        });
        setParticipantCount(msg.participantCount ?? 0);
        setError(null);
        // Wait for their KeyPackage; tryAddPending when it arrives
        break;
      }
      case "peer_left": {
        const leftId = msg.peerId;
        // Invite rotation piggy-backed on leave (also sent as room_code)
        if (msg.publicCode) applyPublicCode(String(msg.publicCode));
        setMembers((prev) => {
          const next = prev.filter((m) => m.id !== leftId);
          membersRef.current = next;
          if (next.length === 0) setState("waiting_peer");
          return next;
        });
        setParticipantCount(msg.participantCount ?? 0);
        setTypingPeers((prev) => prev.filter((id) => id !== leftId));
        pendingKp.current.delete(leftId);

        // Burn only messages that used "on_leave" from the departing user
        if (leftId) burnOnLeaveMessagesFrom(leftId);

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
          // Committer already applied when creating the commit
          if (msg.from === myIdRef.current) return;
          const session = mlsRef.current;
          // No group yet → this is our Add commit; Welcome is the source of truth
          if (!session?.state) return;
          const { session: next, applied } = await processCommitIfNeeded(
            session,
            msg.commit
          );
          if (applied) {
            persistMls(next);
            if (membersRef.current.length > 0) setState("ready");
            // Clear prior stale-commit noise if any
            setError((prev) =>
              prev && /MLS commit failed/i.test(prev) ? null : prev
            );
          }
          // applied=false: stale after Welcome / duplicate — never surface as error
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

            const parsed = decodeAppPayload(result.text);
            if (parsed.kind === "image_part") {
              const progress = imageAssembler.current.ingest({
                id: parsed.id,
                i: parsed.i,
                n: parsed.n,
                mime: parsed.mime,
                name: parsed.name,
                len: parsed.len,
                data: parsed.data,
              });
              if (progress.status === "complete") {
                appendImageMessage(
                  {
                    id: progress.id,
                    from: msg.from,
                    mine: false,
                    ttlMode: msg.ttlMode,
                  },
                  {
                    mime: progress.mime,
                    name: progress.name,
                    bytes: progress.bytes,
                  }
                );
              }
              // pending / error: stay silent (ephemeral transfer)
            } else {
              appendChatMessage(result.text, {
                id: msg.messageId,
                from: msg.from,
                mine: false,
                ttlMode: msg.ttlMode,
              });
            }
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
        burnAllMessages();
        setState("closed");
        setError(`Room closed: ${msg.reason}`);
        clearRoomSession(rid);
        clearCachedMlsSession(rid);
        intentionalClose.current = true;
        break;
      }
      case "room_code": {
        applyPublicCode(String(msg.publicCode ?? ""));
        break;
      }
      case "pong":
        break;
    }
  };

  useEffect(() => {
    // Resolve mapped internal id if this tab already rotated invite codes
    joinIdRef.current = resolveWsInternal(joinIdRef.current);
    roomIdRef.current = joinIdRef.current;

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
    imageAssembler.current.clear();

    const initialId = joinIdRef.current;
    const cached = getCachedMlsSession(initialId);
    mlsRef.current = cached;
    if (cached) setSafetyNumber(epochSafetyNumber(cached));

    setMyId(getOrCreateDisplayId(initialId));

    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      // Always read latest — may upgrade to server internalId after joined
      const id = joinIdRef.current;
      roomIdRef.current = id;
      const token = getOrCreateSessionToken(id);
      const displayId = getOrCreateDisplayId(id);
      const url = getWsUrl(id);
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
            typeof window !== "undefined" &&
              (window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1")
              ? `Connection failed (${url}). Start worker: pnpm dev:worker`
              : `Connection failed — check network and try again`
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
    // joinIdRef is frozen — do not re-connect when Next soft-nav updates roomId prop
    // after invite code rotation.
  }, [clearBurnTimers, clearKpRetries]);

  const sendAppPayload = useCallback(
    async (plaintext: string) => {
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
          const enc = await encryptApp(session, plaintext);
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

          const fromId = myIdRef.current ?? session.identity;
          appendChatMessage(plaintext, {
            id: messageId,
            from: fromId,
            mine: true,
            ttlMode: mode,
          });
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
    [appendChatMessage, persistMls, enqueueMls]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      return sendAppPayload(trimmed);
    },
    [sendAppPayload]
  );

  /**
   * Send a pre-compressed image as paced E2EE MLS chunks (stable on WS).
   * Caller must compress first (see compressImageForSend).
   */
  const sendImage = useCallback(
    async (bytes: Uint8Array, mime: string, name: string) => {
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
      if (bytes.byteLength > LIMITS.maxImageBytes) {
        setError("Image too large after compress");
        return false;
      }

      const transferId = generateMessageId();
      const mode = ttlModeRef.current;
      let frames: string[];
      try {
        frames = encodeAppImageChunks(transferId, mime, name, bytes);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to prepare image");
        return false;
      }

      try {
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i]!;
          const wireId = i === 0 ? transferId : `${transferId}_${i}`;
          const ok = await enqueueMls(async () => {
            const session = mlsRef.current;
            const sock = wsRef.current;
            if (!session?.state || !sock || sock.readyState !== WebSocket.OPEN) {
              return false;
            }
            const enc = await encryptApp(session, frame);
            persistMls(enc.session);
            sock.send(
              JSON.stringify({
                v: PROTOCOL_VERSION,
                type: "message",
                ciphertext: enc.ciphertextB64,
                nonce: MLS_NONCE_MARKER,
                ttlMode: mode,
                messageId: wireId,
              })
            );
            return true;
          });
          if (!ok) {
            setError("Disconnected while sending image");
            return false;
          }
          // Pace under server maxMessagesPerSecond
          if (i < frames.length - 1) {
            await new Promise((r) =>
              setTimeout(r, LIMITS.imageChunkSendGapMs)
            );
          }
        }

        // Show locally once all chunks are out (same transfer id peers will use)
        const fromId = myIdRef.current ?? "You";
        appendImageMessage(
          { id: transferId, from: fromId, mine: true, ttlMode: mode },
          { mime, name, bytes }
        );
        setMeTyping(false);
        lastTypingSent.current = false;
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              v: PROTOCOL_VERSION,
              type: "typing",
              state: false,
            })
          );
        }
        setError(null);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send image");
        return false;
      }
    },
    [appendImageMessage, persistMls, enqueueMls]
  );

  /** Send an animated ASCII emote by id. */
  const sendEmoji = useCallback(
    async (id: AsciiEmojiId | string) => {
      try {
        const payload = encodeAppEmoji(id);
        return await sendAppPayload(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send emoji");
        return false;
      }
    },
    [sendAppPayload]
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
    // Local burn before teardown (peers burn on their peer_left)
    burnAllMessages();
    clearBurnTimers();
    clearKpRetries();
    imageAssembler.current.clear();
    if (typingTimer.current) clearTimeout(typingTimer.current);
    const rid = roomIdRef.current;
    clearRoomSession(rid);
    clearCachedMlsSession(rid);
    // Explicit leave so server rotates invite while socket is still open
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "leave" }));
      }
    } catch {
      /* ignore */
    }
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
  }, [burnAllMessages, clearBurnTimers, clearKpRetries]);

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
    /** Current shareable invite code (may rotate after someone leaves). */
    publicCode,
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
    sendImage,
    sendEmoji,
    notifyTyping,
    leaveRoom,
    canSend: canSendUi,
  };
}
