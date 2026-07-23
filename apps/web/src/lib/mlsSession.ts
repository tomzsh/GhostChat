/**
 * Module-level MLS session cache so React Strict Mode remounts reuse group state.
 * Cleared only on explicit leave / room closed.
 */
import type { MlsSession } from "@ghostchat/crypto";

const cache = new Map<string, MlsSession>();

export function getCachedMlsSession(roomId: string): MlsSession | null {
  return cache.get(roomId) ?? null;
}

export function setCachedMlsSession(roomId: string, session: MlsSession): void {
  cache.set(roomId, session);
}

export function clearCachedMlsSession(roomId: string): void {
  cache.delete(roomId);
}
