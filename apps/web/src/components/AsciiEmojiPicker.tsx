"use client";

import { listAsciiEmojis } from "@/lib/asciiEmoji";
import { AnimatedAsciiEmoji } from "./AnimatedAsciiEmoji";
import type { AsciiEmojiId } from "@ghostchat/shared";

type Props = {
  open: boolean;
  disabled?: boolean;
  onPick: (id: AsciiEmojiId) => void;
  onClose: () => void;
};

/** Compact grid of animated ASCII emotes. */
export function AsciiEmojiPicker({ open, disabled, onPick, onClose }: Props) {
  if (!open) return null;
  const items = listAsciiEmojis();

  return (
    <div
      className="emoji-picker mb-2 rounded border border-ghost-border bg-ghost-bg p-2"
      role="listbox"
      aria-label="ASCII emoji"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ghost-green/80">
          // ascii emoji
        </span>
        <button
          type="button"
          className="text-[10px] text-ghost-dim hover:text-white"
          onClick={onClose}
        >
          close
        </button>
      </div>
      <div className="grid max-h-40 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
        {items.map((e) => (
          <button
            key={e.id}
            type="button"
            role="option"
            disabled={disabled}
            onClick={() => onPick(e.id)}
            className="flex min-h-[4.5rem] flex-col items-center justify-center rounded border border-ghost-border/60 bg-black/40 px-1 py-1.5 touch-manipulation hover:border-ghost-green/50 disabled:opacity-40"
            title={e.label}
          >
            <AnimatedAsciiEmoji id={e.id} className="scale-90" />
            <span className="mt-1 font-mono text-[9px] text-ghost-dim">
              {e.chip}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
