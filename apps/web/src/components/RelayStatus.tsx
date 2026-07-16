"use client";

import { useEffect, useState } from "react";
import { checkRelayHealth } from "@/lib/api";

type Status = "checking" | "online" | "offline";

/** Small pill: whether the Cloudflare worker relay is reachable. */
export function RelayStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probe = async () => {
      const ok = await checkRelayHealth();
      if (!cancelled) setStatus(ok ? "online" : "offline");
      if (!cancelled) {
        timer = setTimeout(probe, ok ? 30_000 : 8_000);
      }
    };

    void probe();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const color =
    status === "online"
      ? "text-ghost-green border-ghost-green/40"
      : status === "offline"
        ? "text-ghost-red border-ghost-red/50"
        : "text-ghost-dim border-ghost-border";

  const label =
    status === "online"
      ? "online"
      : status === "offline"
        ? "offline"
        : "…";

  const title =
    status === "online"
      ? "Relay online"
      : status === "offline"
        ? "Relay offline — run pnpm dev:worker"
        : "Checking relay…";

  return (
    <div
      className={`inline-flex max-w-full items-center gap-1.5 rounded border px-2 py-1 text-[10px] sm:text-[11px] ${color}`}
      role="status"
      aria-live="polite"
      title={title}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          status === "online"
            ? "bg-ghost-green"
            : status === "offline"
              ? "bg-ghost-red"
              : "bg-ghost-dim animate-pulse"
        }`}
        aria-hidden
      />
      <span className="truncate">
        <span className="sm:hidden">relay {label}</span>
        <span className="hidden sm:inline">
          {status === "offline" ? title : `relay ${label}`}
        </span>
      </span>
    </div>
  );
}
