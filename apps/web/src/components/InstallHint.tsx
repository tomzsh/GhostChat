"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Optional “Install app” chip when the browser fires beforeinstallprompt.
 * Hidden if already installed / unsupported.
 */
export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already standalone
    const mq = window.matchMedia("(display-mode: standalone)");
    if (mq.matches || (navigator as Navigator & { standalone?: boolean }).standalone) {
      setHidden(true);
      return;
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (hidden || !deferred) return null;

  return (
    <button
      type="button"
      className="chip !min-h-8 touch-manipulation text-[10px] sm:text-[11px]"
      onClick={async () => {
        try {
          await deferred.prompt();
          const { outcome } = await deferred.userChoice;
          if (outcome === "accepted") setHidden(true);
        } catch {
          /* user dismissed */
        } finally {
          setDeferred(null);
        }
      }}
      title="Install GhostChat on this device"
    >
      Install app
    </button>
  );
}
