"use client";

import { useEffect } from "react";

/**
 * Registers the installable shell service worker in production only.
 * SW never caches /api or chat payloads (see public/sw.js).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Avoid SW cache fights during local hot reload
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (cancelled) return;
        // Pick up a new SW without waiting forever
        reg.update().catch(() => undefined);
      })
      .catch(() => {
        /* install optional — app works without SW */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
