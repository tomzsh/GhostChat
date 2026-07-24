"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TtlMode } from "@ghostchat/shared";
import {
  useGhostRoom,
  type ChatMessage,
  type RoomConnectionState,
} from "@/hooks/useGhostRoom";
import { canNativeShare, copyText, shareRoomCode } from "@/lib/share";
import { CloseRoomModal } from "./CloseRoomModal";
import {
  PresenceAscii,
  type PresenceEvent,
} from "./PresenceAscii";
import { RoomQr } from "./RoomQr";
import { SafetyNumber } from "./SafetyNumber";
import { TerminalFrame } from "./TerminalFrame";
import { TypingAscii } from "./TypingAscii";

const TTL_OPTIONS: {
  value: TtlMode;
  label: string;
  short: string;
  hint: string;
}[] = [
  {
    value: "on_read",
    label: "After read",
    short: "read",
    hint: "Burns shortly after the peer sees it",
  },
  {
    value: "10s",
    label: "10 seconds",
    short: "10s",
    hint: "Auto-delete ~10s after it appears",
  },
  {
    value: "60s",
    label: "60 seconds",
    short: "60s",
    hint: "Auto-delete ~60s after it appears",
  },
  {
    value: "on_leave",
    label: "When I leave",
    short: "leave",
    hint: "No timed delete — burns when you (the sender) leave the room",
  },
];

function ttlShort(mode: TtlMode): string {
  return TTL_OPTIONS.find((o) => o.value === mode)?.short ?? mode;
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function typingStatus(typingPeers: string[]): string | null {
  if (typingPeers.length === 0) return null;
  if (typingPeers.length === 1) return `${shortId(typingPeers[0]!)} typing…`;
  if (typingPeers.length === 2)
    return `${shortId(typingPeers[0]!)} & ${shortId(typingPeers[1]!)} typing…`;
  return `${typingPeers.length} typing…`;
}

function statusLine(
  state: RoomConnectionState,
  peerId: string | null,
  typingPeers: string[],
  memberCount: number
): string {
  switch (state) {
    case "connecting":
      return "Connecting…";
    case "waiting_peer":
      return "Waiting for peer…";
    case "ready": {
      const typing = typingStatus(typingPeers);
      if (typing) return typing;
      if (memberCount <= 1) return `Connected · ${peerId ?? "peer"}`;
      return `Connected · ${memberCount} peers`;
    }
    case "peer_left":
      return "Peer left";
    case "closed":
      return "Room closed";
    case "error":
      return "Error";
    default:
      return state;
  }
}

const MessageRow = memo(function MessageRow({ m }: { m: ChatMessage }) {
  const isImage = m.kind === "image" && m.imageUrl;
  return (
    <div
      className={`rounded px-2 py-1.5 ${
        m.mine ? "bg-ghost-green/5 ml-4 sm:ml-8" : "bg-white/[0.03] mr-4 sm:mr-8"
      } ${m.burning ? "msg-burn" : ""}`}
    >
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-ghost-dim sm:text-[11px]">
          {m.mine ? "you" : m.from}
          {isImage ? " · img" : ""}
        </span>
        <span className="shrink-0 text-[9px] text-ghost-dim/50">
          burn:{ttlShort(m.ttlMode)}
        </span>
      </div>
      {isImage ? (
        <a
          href={m.imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block max-w-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.imageUrl}
            alt={m.imageName || "encrypted image"}
            className="max-h-56 max-w-full rounded border border-ghost-border/60 object-contain"
            loading="lazy"
          />
          {m.imageName ? (
            <span className="mt-1 block truncate text-[10px] text-ghost-dim">
              {m.imageName}
            </span>
          ) : null}
        </a>
      ) : (
        <p
          className={`break-words text-[13px] leading-snug sm:text-sm ${
            m.mine ? "text-ghost-green" : "text-white"
          }`}
        >
          {m.text}
        </p>
      )}
    </div>
  );
});

type Feedback = { kind: "ok" | "err"; text: string } | null;

export function RoomChat({ roomId }: { roomId: string }) {
  const router = useRouter();
  const {
    state,
    myId,
    peerId,
    publicCode,
    members,
    maxParticipants,
    participantCount,
    typingPeers,
    meTyping,
    messages,
    ttlMode,
    setTtlMode,
    error,
    safetyNumber,
    sendMessage,
    sendImage,
    notifyTyping,
    leaveRoom,
    canSend,
  } = useGhostRoom({ roomId });

  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [closing, setClosing] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [supportsShare, setSupportsShare] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [sendingImage, setSendingImage] = useState(false);
  const [presenceEvent, setPresenceEvent] = useState<PresenceEvent | null>(
    null
  );
  const presenceQueue = useRef<PresenceEvent[]>([]);
  const prevMemberIds = useRef<string[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ttlMeta = TTL_OPTIONS.find((o) => o.value === ttlMode);
  const ttlHint = ttlMeta?.hint ?? "How long this message stays on screen";

  useEffect(() => {
    setSupportsShare(canNativeShare());
  }, []);

  // QR: show while waiting; hide when connected (user can re-open)
  useEffect(() => {
    if (state === "waiting_peer" || state === "peer_left") setShowQr(true);
    if (state === "ready") setShowQr(false);
  }, [state]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, typingPeers.length, meTyping, showQr, presenceEvent]);

  // Keep --app-height in sync with visual viewport (mobile keyboard / browser chrome)
  useEffect(() => {
    const setH = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${h}px`);
    };
    setH();
    window.visualViewport?.addEventListener("resize", setH);
    window.visualViewport?.addEventListener("scroll", setH);
    window.addEventListener("resize", setH);
    return () => {
      window.visualViewport?.removeEventListener("resize", setH);
      window.visualViewport?.removeEventListener("scroll", setH);
      window.removeEventListener("resize", setH);
    };
  }, []);

  const flash = useCallback((kind: "ok" | "err", text: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedback({ kind, text });
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1600);
  }, []);

  // After code rotation, surface QR again so host can re-share
  const prevCodeRef = useRef(publicCode);
  useEffect(() => {
    if (prevCodeRef.current !== publicCode && publicCode) {
      if (prevCodeRef.current) {
        setShowQr(true);
        flash("ok", `New code ${publicCode}`);
      }
      prevCodeRef.current = publicCode;
    }
  }, [publicCode, flash]);

  // Queue ASCII presence banners when members join / leave
  useEffect(() => {
    const curr = members.map((m) => m.id);
    const prev = prevMemberIds.current;
    prevMemberIds.current = curr;
    // Skip first snapshot (initial join list — no banner spam)
    if (prev === null) return;

    const prevSet = new Set(prev);
    const currSet = new Set(curr);
    const events: PresenceEvent[] = [];
    for (const id of curr) {
      if (!prevSet.has(id)) events.push({ kind: "join", id });
    }
    for (const id of prev) {
      if (!currSet.has(id)) events.push({ kind: "leave", id });
    }
    if (events.length === 0) return;

    presenceQueue.current.push(...events);
    // Start banner only if idle (don't shift twice)
    setPresenceEvent((cur) => {
      if (cur) return cur;
      return presenceQueue.current.shift() ?? null;
    });
  }, [members]);

  const onPresenceDone = useCallback(() => {
    setPresenceEvent((cur) => {
      // Drop current; pull next from queue
      void cur;
      return presenceQueue.current.shift() ?? null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const ok = await sendMessage(draft);
      if (ok) {
        setDraft("");
        notifyTyping(false);
        // Keep focus for rapid mobile typing
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    },
    [draft, sendMessage, notifyTyping]
  );

  const shareCode = publicCode || roomId;

  const onCopyCode = useCallback(async () => {
    const ok = await copyText(shareCode);
    flash(ok ? "ok" : "err", ok ? "Copied" : "Copy failed");
  }, [shareCode, flash]);

  const onShare = useCallback(async () => {
    const result = await shareRoomCode(shareCode);
    if (result === "shared") flash("ok", "Shared");
    else if (result === "copied") flash("ok", "Copied");
    else if (result === "failed") flash("err", "Share failed");
  }, [shareCode, flash]);

  const openCloseModal = useCallback(() => {
    if (closing) return;
    if (state === "closed" || state === "error") {
      setClosing(true);
      leaveRoom();
      router.replace("/");
      return;
    }
    setCloseModalOpen(true);
  }, [closing, state, leaveRoom, router]);

  const confirmCloseRoom = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setCloseModalOpen(false);
    leaveRoom();
    router.replace("/");
  }, [closing, leaveRoom, router]);

  const onDraftChange = useCallback(
    (value: string) => {
      setDraft(value);
      if (value.length > 0) notifyTyping(true);
      else notifyTyping(false);
    },
    [notifyTyping]
  );

  const onPickImage = useCallback(() => {
    if (!canSend || sendingImage) return;
    fileInputRef.current?.click();
  }, [canSend, sendingImage]);

  const onImageSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !canSend) return;
      setSendingImage(true);
      try {
        const { compressImageForSend } = await import("@/lib/compressImage");
        const compressed = await compressImageForSend(file);
        const ok = await sendImage(
          compressed.bytes,
          compressed.mime,
          compressed.name
        );
        if (ok) flash("ok", "Image sent");
        else flash("err", "Send failed");
      } catch (err) {
        flash(
          "err",
          err instanceof Error ? err.message : "Image compress failed"
        );
      } finally {
        setSendingImage(false);
      }
    },
    [canSend, sendImage, flash]
  );

  return (
    <>
    <TerminalFrame
      variant="app"
      title={shareCode}
      hideFooterOnMobile
      headerRight={
        <button
          type="button"
          onClick={openCloseModal}
          disabled={closing}
          className="chip chip--danger"
          aria-label="Close room"
        >
          {closing ? "…" : "Close"}
        </button>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="truncate">{myId ? `you: ${myId}` : "…"} · e2ee</span>
          <span className="truncate text-ghost-dim">
            {statusLine(state, peerId, typingPeers, members.length)}
          </span>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Compact toolbar */}
        <div className="safe-x shrink-0 border-b border-ghost-border/60 px-2.5 py-2 sm:px-4">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={onCopyCode}
              className="chip chip--active font-mono tracking-widest"
              aria-label={`Copy room code ${shareCode}`}
            >
              {shareCode}
            </button>
            <button type="button" onClick={onCopyCode} className="chip">
              copy
            </button>
            {supportsShare ? (
              <button type="button" onClick={onShare} className="chip">
                share
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowQr((v) => !v)}
              className={`chip ${showQr ? "chip--active" : ""}`}
              aria-expanded={showQr}
            >
              QR
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] sm:text-[11px]">
            <span className="font-medium text-ghost-green/90">
              {participantCount}/{maxParticipants}
            </span>
            <span className="text-ghost-dim">
              {statusLine(state, peerId, typingPeers, members.length)}
            </span>
            {state === "waiting_peer" && (
              <span className="text-ghost-amber">
                {members.length === 0
                  ? "Share code or QR"
                  : "Waiting for MLS welcome…"}
              </span>
            )}
            {feedback ? (
              <span
                className={
                  feedback.kind === "ok" ? "text-ghost-green" : "text-ghost-red"
                }
                role="status"
              >
                {feedback.text}
              </span>
            ) : null}
          </div>

          {/* Member chips — typing indicator per peer */}
          {(myId || members.length > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {myId ? (
                <span
                  className={`chip chip--active !min-h-7 text-[10px] ${
                    meTyping ? "ring-1 ring-ghost-green/40" : ""
                  }`}
                >
                  you · {myId}
                  {meTyping ? " · …" : ""}
                </span>
              ) : null}
              {members.map((m) => {
                const isTyping = typingPeers.includes(m.id);
                return (
                  <span
                    key={m.id}
                    className={`chip !min-h-7 text-[10px] ${
                      isTyping
                        ? "border-ghost-green/50 text-ghost-green ring-1 ring-ghost-green/30"
                        : ""
                    }`}
                    title={isTyping ? `${m.id} is typing` : m.id}
                  >
                    {m.id}
                    {isTyping ? " · …" : ""}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <PresenceAscii event={presenceEvent} onDone={onPresenceDone} />

        {/* QR — compact, only when open */}
        {showQr ? (
          <div className="shrink-0 border-b border-ghost-border/40 px-2.5 py-2 sm:px-4">
            <RoomQr
              roomId={shareCode}
              compact
              className="mx-auto w-full max-w-[200px]"
            />
            {publicCode !== roomId ? (
              <p className="mt-1 text-center text-[10px] text-ghost-amber">
                Code rotated · old invite invalid
              </p>
            ) : null}
          </div>
        ) : null}

        {safetyNumber && state === "ready" ? (
          <SafetyNumber value={safetyNumber} />
        ) : null}

        {/* Messages — takes remaining space */}
        <div
          className="chat-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 py-2 sm:space-y-2 sm:px-4 sm:py-3"
          role="log"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <p className="px-1 py-4 text-center text-[11px] text-ghost-dim sm:text-xs">
              {canSend
                ? "Encrypted channel open — type below"
                : "No messages yet"}
            </p>
          ) : null}
          {messages.map((m) => (
            <MessageRow key={m.id} m={m} />
          ))}
          <div ref={bottomRef} className="h-px" />
        </div>

        <TypingAscii
          meTyping={meTyping && canSend}
          typingPeers={canSend ? typingPeers : []}
        />

        {error ? (
          <p
            className="shrink-0 px-2.5 text-[11px] text-ghost-red sm:px-4 sm:text-xs"
            role="alert"
          >
            ! {error}
          </p>
        ) : null}

        {/* Composer — single owner of bottom safe area */}
        <form
          onSubmit={onSubmit}
          className="safe-bottom shrink-0 border-t border-ghost-border bg-ghost-panel px-2.5 pt-2 sm:px-4 sm:pt-2.5"
        >
          <div className="mb-1.5 flex items-center gap-2">
            <label
              htmlFor="ttl"
              className="shrink-0 text-[10px] font-medium text-ghost-green/90 sm:text-[11px]"
            >
              Burn
            </label>
            <select
              id="ttl"
              value={ttlMode}
              onChange={(e) => setTtlMode(e.target.value as TtlMode)}
              className="min-h-9 min-w-0 flex-1 touch-manipulation border border-ghost-border bg-ghost-bg px-2 text-[13px] text-ghost-green sm:min-h-8 sm:flex-none sm:text-xs"
              title={ttlHint}
              aria-describedby="ttl-hint"
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {!canSend ? (
              <span className="shrink-0 text-[10px] text-ghost-amber sm:text-[11px]">
                locked
              </span>
            ) : null}
          </div>
          <p
            id="ttl-hint"
            className="mb-1.5 hidden text-[10px] leading-snug text-ghost-dim/70 sm:block sm:text-[11px]"
          >
            {ttlHint}
          </p>
          <div className="flex items-stretch gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={onImageSelected}
            />
            <button
              type="button"
              onClick={onPickImage}
              disabled={!canSend || sendingImage}
              className="chip !min-h-11 shrink-0 touch-manipulation px-2.5 text-[12px] disabled:opacity-40"
              aria-label="Send image"
              title="Send compressed image (E2EE)"
            >
              {sendingImage ? "…" : "img"}
            </button>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              disabled={!canSend}
              placeholder={canSend ? "Message…" : "Waiting for peer…"}
              maxLength={2000}
              enterKeyHint="send"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="sentences"
              spellCheck={false}
              className="min-h-11 min-w-0 flex-1 touch-manipulation border border-ghost-border bg-ghost-bg px-3 text-base text-white placeholder:text-ghost-dim/45 disabled:opacity-40 focus:border-ghost-green sm:min-h-11 sm:text-sm"
            />
            <button
              type="submit"
              disabled={!canSend || !draft.trim() || sendingImage}
              className="min-h-11 min-w-[4.25rem] shrink-0 touch-manipulation bg-ghost-green px-3 text-sm font-semibold text-black disabled:opacity-40 sm:min-w-[5rem]"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </TerminalFrame>

    <CloseRoomModal
      open={closeModalOpen}
      busy={closing}
      onCancel={() => setCloseModalOpen(false)}
      onConfirm={confirmCloseRoom}
    />
    </>
  );
}
