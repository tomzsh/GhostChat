"use client";

import { useEffect, useState } from "react";

const FRAMES = [
  [
    "  .--.",
    " /    \\",
    "|  ()  |  bye",
    " \\    /",
    "  `--'",
  ].join("\n"),
  [
    "  .--.",
    " / ~~ \\",
    "|  ()  |  …",
    " \\ ~~ /",
    "  `--'",
  ].join("\n"),
  [
    "  .--.",
    " / ## \\",
    "|  xx  |  burn",
    " \\ ## /",
    "  `--'",
  ].join("\n"),
  [
    "   ..",
    "  .##.",
    " |####|  ash",
    "  `##'",
    "   ''",
  ].join("\n"),
  [
    "    .",
    "   .#.",
    "  :###:  …",
    "   `#'",
    "    '",
  ].join("\n"),
  [
    "    ·",
    "   · ·",
    "  ·   ·  gone",
    "   · ·",
    "    ·",
  ].join("\n"),
];

const EXIT_FRAMES = [
  "  [·    ]  closing",
  "  [··   ]  closing",
  "  [···  ]  closing",
  "  [···· ]  closing",
  "  [·····]  closed",
];

type Props = {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Terminal-style confirm modal for leaving a room — ASCII burn animation.
 */
export function CloseRoomModal({ open, busy, onConfirm, onCancel }: Props) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) {
      setTick(0);
      return;
    }
    const id = window.setInterval(() => setTick((t) => t + 1), 180);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
      if (e.key === "Enter" && !busy) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  const art = FRAMES[tick % FRAMES.length]!;
  const bar = EXIT_FRAMES[Math.min(tick % EXIT_FRAMES.length, EXIT_FRAMES.length - 1)]!;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-room-title"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="close-modal w-full max-w-sm border border-ghost-green/40 bg-ghost-bg p-4 shadow-[0_0_24px_rgba(51,255,102,0.12)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p
          id="close-room-title"
          className="mb-2 font-mono text-[11px] uppercase tracking-widest text-ghost-green"
        >
          // close room
        </p>
        <pre
          className="close-modal__art mb-3 overflow-x-auto whitespace-pre font-mono text-[11px] leading-tight text-ghost-green sm:text-xs"
          aria-hidden
        >
          {art}
        </pre>
        <p className="mb-1 font-mono text-[10px] text-ghost-dim">{bar}</p>
        <p className="mb-4 text-[12px] leading-snug text-ghost-dim sm:text-[13px]">
          Leave this room? Messages on this device vanish. Peers see you leave —
          invite code rotates for those who stay.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="chip min-h-11 touch-manipulation sm:min-h-9"
            onClick={onCancel}
            disabled={busy}
          >
            stay
          </button>
          <button
            type="button"
            className="chip chip--danger min-h-11 touch-manipulation sm:min-h-9"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? "closing…" : "close room"}
          </button>
        </div>
      </div>
    </div>
  );
}
