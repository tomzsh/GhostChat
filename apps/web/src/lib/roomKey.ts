/**
 * Tab-scoped cache for the group room AEAD key.
 * Survives React Strict Mode remounts so we don't mint a new key and
 * diverge from peers who still hold the previous one.
 * Cleared on leave / room closed — never written to storage.
 */

const cache = new Map<string, Uint8Array>();

export function getCachedRoomKey(roomId: string): Uint8Array | null {
  return cache.get(roomId) ?? null;
}

export function setCachedRoomKey(roomId: string, key: Uint8Array): void {
  cache.set(roomId, key);
}

export function clearCachedRoomKey(roomId: string): void {
  const k = cache.get(roomId);
  if (k) k.fill(0);
  cache.delete(roomId);
}
