"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Compact QR for room join URL — sized for mobile chat chrome.
 * Absolute URL is set only after mount to avoid SSR hydration mismatch.
 */
export function RoomQr({
  roomId,
  className = "",
  compact = false,
}: {
  roomId: string;
  className?: string;
  /** Smaller footprint for narrow chat header area */
  compact?: boolean;
}) {
  // SSR + first client paint: same relative path (no window)
  const path = `/r/${roomId}`;
  const [joinUrl, setJoinUrl] = useState(path);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Resolve absolute origin after hydration only
  useEffect(() => {
    setJoinUrl(`${window.location.origin}/r/${roomId}`);
  }, [roomId]);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    // Wait until we have an absolute URL so QR works off-device scans
    if (!joinUrl.startsWith("http")) {
      setDataUrl(null);
      return;
    }
    const size = compact ? 140 : 180;
    QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
      color: {
        dark: "#33ff66",
        light: "#0a0a0a",
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setErr("QR failed");
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl, compact]);

  const box = compact ? "size-28" : "size-32 sm:size-36";

  return (
    <div
      className={`flex flex-col items-center gap-1.5 border border-ghost-border/70 bg-ghost-bg/80 p-2.5 sm:gap-2 sm:p-3 ${className}`}
    >
      <p className="text-[10px] uppercase tracking-wider text-ghost-dim">
        Scan to join · {roomId}
      </p>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={`QR code to join room ${roomId}`}
          width={compact ? 112 : 128}
          height={compact ? 112 : 128}
          className={box}
          draggable={false}
        />
      ) : err ? (
        <p className="text-xs text-ghost-red">{err}</p>
      ) : (
        <div
          className={`flex ${box} items-center justify-center text-xs text-ghost-dim`}
        >
          …
        </div>
      )}
      {/* Hide long URL on very small screens — code is enough */}
      <p className="hidden max-w-full break-all text-center font-mono text-[9px] text-ghost-dim/80 sm:block sm:text-[10px]">
        {joinUrl}
      </p>
    </div>
  );
}
