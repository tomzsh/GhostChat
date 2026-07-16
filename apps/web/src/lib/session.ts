/** sessionStorage only — never localStorage (ephemeral identity) */
import { generateDisplayId, randomChars } from "@ghostchat/shared";

const PREFIX = "ghostchat:";

export function sessionGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function sessionSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PREFIX + key, value);
  } catch {
    /* private mode etc. */
  }
}

export function sessionRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * Stable per-tab session token created BEFORE first WS join.
 * Prevents React Strict Mode from creating two sessions and filling the room.
 */
export function getOrCreateSessionToken(roomId: string): string {
  const key = `session:${roomId}`;
  let token = sessionGet(key);
  if (!token || token.length < 8) {
    token = randomChars(24);
    sessionSet(key, token);
  }
  return token;
}

export function getOrCreateDisplayId(roomId: string): string {
  const key = `display:${roomId}`;
  let id = sessionGet(key);
  if (!id || !id.startsWith("Anon-")) {
    id = generateDisplayId();
    sessionSet(key, id);
  }
  return id;
}

export function clearRoomSession(roomId: string): void {
  sessionRemove(`session:${roomId}`);
  sessionRemove(`display:${roomId}`);
}
