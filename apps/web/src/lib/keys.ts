/**
 * Module-level key store so React Strict Mode remounts reuse the same
 * X25519 keypair for a room (avoids peer holding a stale public key).
 * Keys stay in memory only — never localStorage.
 */
import { generateKeyPair, type KeyPair } from "@ghostchat/crypto";

const store = new Map<string, KeyPair>();

export function getOrCreateRoomKeyPair(roomId: string): KeyPair {
  let kp = store.get(roomId);
  if (!kp) {
    kp = generateKeyPair();
    store.set(roomId, kp);
  }
  return kp;
}

export function clearRoomKeyPair(roomId: string): void {
  const kp = store.get(roomId);
  if (kp) {
    kp.privateKey.fill(0);
    store.delete(roomId);
  }
}
