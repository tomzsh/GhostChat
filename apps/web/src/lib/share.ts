/** Clipboard + Web Share helpers for room codes */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Prefer native share sheet (mobile). Falls back to copy of room code.
 * Returns: 'shared' | 'copied' | 'cancelled' | 'failed'
 */
export async function shareRoomCode(
  roomId: string,
  roomUrl?: string
): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url =
    roomUrl ??
    (typeof window !== "undefined"
      ? `${window.location.origin}/r/${roomId}`
      : undefined);

  if (canNativeShare()) {
    try {
      await navigator.share({
        title: "GhostChat room",
        text: `Join my GhostChat room. Code: ${roomId}`,
        ...(url ? { url } : {}),
      });
      return "shared";
    } catch (e) {
      // User dismissed the sheet
      if (e instanceof DOMException && e.name === "AbortError") {
        return "cancelled";
      }
      // Fall through to copy
    }
  }

  const ok = await copyText(roomId);
  return ok ? "copied" : "failed";
}
