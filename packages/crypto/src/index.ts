/**
 * GhostChat crypto: X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305.
 * Private keys never leave client memory; server only sees public keys + ciphertext.
 */
import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

const NONCE_LENGTH = 24; // XChaCha20
const KEY_LENGTH = 32;

export type KeyPair = {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
};

export function generateKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

export function deriveSharedKey(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array,
  roomId: string
): Uint8Array {
  const shared = x25519.getSharedSecret(privateKey, peerPublicKey);
  // HKDF with roomId as info — never use raw ECDH secret as AEAD key
  return hkdf(sha256, shared, undefined, utf8ToBytes(`ghostchat:${roomId}`), KEY_LENGTH);
}

export type EncryptedPayload = {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
};

export function encrypt(
  key: Uint8Array,
  plaintext: string
): EncryptedPayload {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(utf8ToBytes(plaintext));
  return { ciphertext, nonce };
}

export function decrypt(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array
): string {
  const cipher = xchacha20poly1305(key, nonce);
  const plain = cipher.decrypt(ciphertext);
  return new TextDecoder().decode(plain);
}

// --- wire encoding helpers (pure; works in browser, Node, Workers) ---

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  // btoa is available in browsers/Workers; Node 16+ provides it globally too
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function publicKeyToBase64(pk: Uint8Array): string {
  return toBase64(pk);
}

export function publicKeyFromBase64(b64: string): Uint8Array {
  return fromBase64(b64);
}

export function encryptToWire(
  key: Uint8Array,
  plaintext: string
): { ciphertext: string; nonce: string } {
  const { ciphertext, nonce } = encrypt(key, plaintext);
  return { ciphertext: toBase64(ciphertext), nonce: toBase64(nonce) };
}

export function decryptFromWire(
  key: Uint8Array,
  ciphertextB64: string,
  nonceB64: string
): string {
  return decrypt(key, fromBase64(ciphertextB64), fromBase64(nonceB64));
}

/**
 * Human-comparable safety number from the AEAD shared key (SHA-256).
 * Both peers must see the same value if the channel is not MITM'd.
 * Format: `XXXXX XXXXX XXXXX` (15 digits).
 */
export function safetyNumberFromKey(sharedKey: Uint8Array): string {
  const dig = sha256(sharedKey);
  const parts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const n =
      ((dig[i * 3]! << 16) | (dig[i * 3 + 1]! << 8) | dig[i * 3 + 2]!) >>> 0;
    parts.push(String(n % 100_000).padStart(5, "0"));
  }
  return parts.join(" ");
}

// re-export utils sometimes useful for tests
export { bytesToHex, hexToBytes };
