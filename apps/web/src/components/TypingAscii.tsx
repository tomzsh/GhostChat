"use client";

import { useEffect, useState } from "react";

const WAVE = ["~   ", "~~  ", "~~~ ", "~~~~", " ~~~", "  ~~", "   ~", "    "];
const DOTS = [".  ", ".. ", "...", " ..", "  .", "   "];
const EYES_ME = ["o_o", "O_o", "o_O", "-_-", "o_o", "^_^"];
const EYES_PEER = ["^_^", "o_o", "O_O", "^o^", "^_^", "-_-"];

function short(id?: string | null): string {
  if (!id) return "peer";
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatPeerList(ids: string[]): string {
  if (ids.length === 0) return "peer";
  if (ids.length === 1) return short(ids[0]);
  if (ids.length === 2) return `${short(ids[0])} & ${short(ids[1])}`;
  return `${ids.length} peers`;
}

/** Compact 3-line frames for mobile */
function frameCompact(
  tick: number,
  mode: "me" | "peer" | "both",
  peerLabel: string
): string {
  const w = WAVE[tick % WAVE.length]!.trimEnd() || "~";
  const em = EYES_ME[tick % EYES_ME.length]!;
  const ep = EYES_PEER[tick % EYES_PEER.length]!;
  const d = DOTS[tick % DOTS.length]!;

  if (mode === "both") {
    return [
      ` ( ${em} ) ${w} ( ${ep} )`,
      `  you        ${peerLabel}`,
      `  ${d} chatting ${d}`,
    ].join("\n");
  }
  if (mode === "me") {
    return [
      ` ( ${em} )  ${w}`,
      `  you typing`,
      `  ${d}`,
    ].join("\n");
  }
  return [
    `        ( ${ep} )`,
    `  ${w}  ${peerLabel}`,
    `        ${d}`,
  ].join("\n");
}

function frameFull(
  tick: number,
  mode: "me" | "peer" | "both",
  peerLabel: string
): string {
  const w = WAVE[tick % WAVE.length]!;
  const em = EYES_ME[tick % EYES_ME.length]!;
  const ep = EYES_PEER[(tick + 2) % EYES_PEER.length]!;
  const bob = tick % 2 === 0 ? " " : ".";
  const d = DOTS[tick % DOTS.length]!;

  if (mode === "both") {
    return [
      `  .---.${bob}      ${bob}.---.`,
      ` ( ${em} ) ${w.trim()} ( ${ep} )`,
      `  > " < ···· > " <`,
      `  you          ${peerLabel}`,
    ].join("\n");
  }
  if (mode === "me") {
    return [
      `  .---.${bob}`,
      ` ( ${em} )  ${d}`,
      `  > " <  ${w.trim()}`,
      `  you are typing`,
    ].join("\n");
  }
  return [
    `            .---.${bob}`,
    `     ${d}  ( ${ep} )`,
    `    ${w.trim()}  > " <`,
    `            ${peerLabel}`,
  ].join("\n");
}

/**
 * Animated terminal ASCII while typing — supports multi-peer groups.
 */
export function TypingAscii({
  meTyping,
  typingPeers = [],
  /** @deprecated use typingPeers */
  peerTyping,
  /** @deprecated use typingPeers */
  peerId,
}: {
  meTyping: boolean;
  /** Peer display ids currently typing */
  typingPeers?: string[];
  peerTyping?: boolean;
  peerId?: string | null;
}) {
  const peers =
    typingPeers.length > 0
      ? typingPeers
      : peerTyping && peerId
        ? [peerId]
        : peerTyping
          ? ["peer"]
          : [];
  const hasPeers = peers.length > 0;
  const active = meTyping || hasPeers;
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(false);
  const [compact, setCompact] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const id = window.setInterval(() => setTick((t) => t + 1), 150);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active && !visible) return null;

  const both = meTyping && hasPeers;
  const onlyMe = meTyping && !hasPeers;
  const mode = both ? "both" : onlyMe ? "me" : "peer";
  const peerLabel = formatPeerList(peers);
  const art = compact
    ? frameCompact(tick, mode, peerLabel)
    : frameFull(tick, mode, peerLabel);

  const label = both
    ? `You + ${peerLabel} typing`
    : onlyMe
      ? "You are typing"
      : peers.length > 1
        ? `${peerLabel} are typing`
        : `${peerLabel} is typing`;

  const caption = both
    ? peers.length > 1
      ? "group chatter…"
      : "both chatting…"
    : onlyMe
      ? "sending…"
      : peers.length > 1
        ? `${peers.length} typing…`
        : "incoming…";

  return (
    <div
      className={`typing-ascii shrink-0 border-t border-ghost-border/50 bg-ghost-bg/70 px-2.5 py-1.5 sm:px-4 sm:py-2 ${
        active ? "typing-ascii--in" : "typing-ascii--out"
      }`}
      role="status"
      aria-live="polite"
      aria-label={label}
      onTransitionEnd={() => {
        if (!active) setVisible(false);
      }}
    >
      <pre className="typing-ascii__art whitespace-pre font-mono text-[9px] leading-tight text-ghost-green sm:text-[11px]">
        {art}
      </pre>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-ghost-dim">
        <span className="inline-flex gap-0.5" aria-hidden>
          <span className="typing-dot">●</span>
          <span className="typing-dot">●</span>
          <span className="typing-dot">●</span>
        </span>
        <span className="typing-ascii__caption min-w-0 truncate">
          {caption}
          {hasPeers && !onlyMe ? (
            <span className="text-ghost-green/70"> · {peerLabel}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
