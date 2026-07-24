/** sessionStorage only — never localStorage (ephemeral identity) */
import {
  generateDisplayId,
  isValidRoomId,
  normalizeRoomId,
  randomChars,
} from "@ghostchat/shared";

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

/**
 * Map a public invite code → stable internal WS/DO id for this tab.
 * Survives code rotation + Next soft-nav remounts.
 */
export function rememberWsInternal(publicCode: string, internalId: string): void {
  const pub = normalizeRoomId(publicCode);
  const internal = normalizeRoomId(internalId);
  if (!isValidRoomId(pub) || !isValidRoomId(internal)) return;
  sessionSet(`wsInternal:${pub}`, internal);
  // Also pin the internal id to itself
  sessionSet(`wsInternal:${internal}`, internal);
}

/** Resolve URL/join code to the stable WS room id if we already know it. */
export function resolveWsInternal(code: string): string {
  const c = normalizeRoomId(code);
  if (!isValidRoomId(c)) return c;
  const mapped = sessionGet(`wsInternal:${c}`);
  if (mapped && isValidRoomId(mapped)) return mapped;
  return c;
}

/** Copy session + display keys when we learn the true internal id. */
export function migrateRoomIdentity(fromCode: string, toInternal: string): void {
  const from = normalizeRoomId(fromCode);
  const to = normalizeRoomId(toInternal);
  if (!isValidRoomId(from) || !isValidRoomId(to) || from === to) return;
  const tok = sessionGet(`session:${from}`);
  if (tok) sessionSet(`session:${to}`, tok);
  const disp = sessionGet(`display:${from}`);
  if (disp) sessionSet(`display:${to}`, disp);
  rememberWsInternal(from, to);
}

export function clearRoomSession(roomId: string): void {
  const id = normalizeRoomId(roomId);
  const internal = resolveWsInternal(id);
  sessionRemove(`session:${id}`);
  sessionRemove(`display:${id}`);
  sessionRemove(`wsInternal:${id}`);
  if (internal !== id) {
    sessionRemove(`session:${internal}`);
    sessionRemove(`display:${internal}`);
    sessionRemove(`wsInternal:${internal}`);
  }
}
