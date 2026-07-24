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

    // New SW takes over; soft-reload once so clients leave broken v1 caches
    const onControllerChange = () => {
      // Avoid reload loops: only when an update activates
      if (sessionStorage.getItem("gc-sw-reloaded") === "1") return;
      sessionStorage.setItem("gc-sw-reloaded", "1");
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        reg.update().catch(() => undefined);
        // Clear one-shot flag after a successful control
        if (navigator.serviceWorker.controller) {
          sessionStorage.removeItem("gc-sw-reloaded");
        }
      })
      .catch(() => {
        /* install optional — app works without SW */
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
    };
  }, []);

  return null;
}
