"use client";

import { useEffect, useState } from "react";
import { getAsciiEmoji } from "@/lib/asciiEmoji";

/** Looping multi-frame ASCII emote for chat bubbles. */
export function AnimatedAsciiEmoji({
  id,
  className = "",
}: {
  id: string;
  className?: string;
}) {
  const def = getAsciiEmoji(id);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!def || def.frames.length < 2) return;
    const ms = def.tickMs || 150;
    const t = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [def]);

  if (!def) {
    return (
      <span className="font-mono text-xs text-ghost-dim">:{id}:</span>
    );
  }

  const frame = def.frames[tick % def.frames.length]!;

  return (
    <pre
      className={`ascii-emoji whitespace-pre font-mono text-[11px] leading-tight text-ghost-green sm:text-xs ${className}`}
      aria-label={def.label}
      title={def.label}
    >
      {frame}
    </pre>
  );
}
