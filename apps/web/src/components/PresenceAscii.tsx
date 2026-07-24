"use client";

import { useEffect, useState } from "react";

export type PresenceEvent = {
  kind: "join" | "leave";
  id: string;
};

function short(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

const JOIN_FRAMES = [
  [
    "      *",
    "     / \\",
    "    | o |  hello?",
    "     \\_/",
    "      |",
  ].join("\n"),
  [
    "     \\*/",
    "     / \\",
    "    | ^ |  hi!",
    "     \\_/",
    "     / \\",
  ].join("\n"),
  [
    "    \\ | /",
    "     \\*/",
    "    | ^ |  joined",
    "     \\_/",
    "     / \\",
  ].join("\n"),
  [
    "   .--*--.",
    "  /  ^ ^  \\",
    " |   \\_/   |  online",
    "  \\       /",
    "   `-----'",
  ].join("\n"),
  [
    "   .-----.",
    "  /  o o  \\",
    " |    >    |  +peer",
    "  \\  \\_/  /",
    "   `-----'",
  ].join("\n"),
];

const LEAVE_FRAMES = [
  [
    "   .-----.",
    "  /  o o  \\",
    " |    ~    |  …",
    "  \\  ---  /",
    "   `-----'",
  ].join("\n"),
  [
    "   .-----.",
    "  /  - -  \\",
    " |    ~    |  bye",
    "  \\  ---  /",
    "   `-----'",
  ].join("\n"),
  [
    "   .  -  .",
    "  /  x x  \\",
    " |    -    |  left",
    "  \\  ...  /",
    "   `.....`",
  ].join("\n"),
  [
    "    .   .",
    "   / \\ / \\",
    "  |  x x  |  ash",
    "   \\  ~  /",
    "    `...`",
  ].join("\n"),
  [
    "     · ·",
    "    ·   ·",
    "   ·  ~  ·  gone",
    "    ·   ·",
    "     · ·",
  ].join("\n"),
];

const HOLD_MS = 2800;
const TICK_MS = 160;

/**
 * Brief terminal ASCII banner when a peer joins or leaves.
 */
export function PresenceAscii({
  event,
  onDone,
}: {
  event: PresenceEvent | null;
  onDone?: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!event) {
      setActive(false);
      return;
    }
    setTick(0);
    setVisible(true);
    setActive(true);
    const hold = window.setTimeout(() => {
      setActive(false);
    }, HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [event]);

  useEffect(() => {
    if (!active || !event) return;
    const id = window.setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [active, event]);

  if (!event && !visible) return null;
  if (!event) return null;

  const frames = event.kind === "join" ? JOIN_FRAMES : LEAVE_FRAMES;
  const art = frames[tick % frames.length]!;
  const label =
    event.kind === "join"
      ? `${short(event.id)} joined`
      : `${short(event.id)} left`;
  const caption =
    event.kind === "join" ? "+ member online" : "− member offline";
  const accent =
    event.kind === "join" ? "text-ghost-green" : "text-ghost-amber";

  return (
    <div
      className={`presence-ascii shrink-0 border-b border-ghost-border/50 bg-ghost-bg/80 px-2.5 py-1.5 sm:px-4 sm:py-2 ${
        active ? "presence-ascii--in" : "presence-ascii--out"
      }`}
      role="status"
      aria-live="polite"
      aria-label={label}
      onTransitionEnd={() => {
        if (!active) {
          setVisible(false);
          onDone?.();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <pre
          className={`presence-ascii__art whitespace-pre font-mono text-[9px] leading-tight sm:text-[11px] ${accent}`}
        >
          {art}
        </pre>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className={`truncate font-mono text-[11px] sm:text-xs ${accent}`}>
            {event.kind === "join" ? ">> " : "<< "}
            {label}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-ghost-dim">
            {caption}
          </p>
          <p className="mt-1 font-mono text-[9px] text-ghost-dim/70">
            {event.kind === "join"
              ? "[·]····· entering"
              : "[·····]· exiting"}
            <span className="inline-block w-3 animate-pulse">_</span>
          </p>
        </div>
      </div>
    </div>
  );
}
