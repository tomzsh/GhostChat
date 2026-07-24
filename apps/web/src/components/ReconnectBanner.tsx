"use client";

/**
 * Non-blocking strip when the socket is reconnecting after a prior session.
 */
export function ReconnectBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="shrink-0 border-b border-ghost-amber/40 bg-ghost-amber/10 px-2.5 py-1.5 text-center font-mono text-[10px] text-ghost-amber sm:px-4 sm:text-[11px]"
      role="status"
      aria-live="polite"
    >
      Reconnecting to relay…
    </div>
  );
}
