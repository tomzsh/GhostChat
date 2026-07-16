"use client";

import { useState } from "react";
import { copyText } from "@/lib/share";

/**
 * Safety number — compact on mobile, expandable help.
 */
export function SafetyNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function onCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="border-b border-ghost-border/50 bg-ghost-bg/40 px-2.5 py-1.5 sm:px-4 sm:py-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="min-h-10 min-w-0 flex-1 touch-manipulation text-left"
          aria-expanded={open}
        >
          <span className="block text-[10px] uppercase tracking-wide text-ghost-green sm:text-[11px]">
            Safety number {open ? "▲" : "▼"}
          </span>
          <span className="mt-0.5 block break-all font-mono text-xs tracking-wide text-white sm:text-sm sm:tracking-wider">
            {value}
          </span>
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="chip chip--active shrink-0 self-center"
        >
          {copied ? "ok" : "copy"}
        </button>
      </div>
      {open ? (
        <p className="mt-1.5 border-t border-ghost-border/40 pt-1.5 text-[10px] leading-relaxed text-ghost-dim sm:text-[11px]">
          Both of you should see the <strong className="text-white">same</strong>{" "}
          number. Compare by voice or in person. If it differs, leave the room.
        </p>
      ) : null}
    </div>
  );
}
