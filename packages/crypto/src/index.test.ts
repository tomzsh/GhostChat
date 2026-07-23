/**
 * Crypto unit tests — run with: pnpm --filter @ghostchat/crypto test
 * Uses Node's built-in test runner (no extra deps).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  encryptToWire,
  decryptFromWire,
  publicKeyToBase64,
  publicKeyFromBase64,
  toBase64,
  fromBase64,
  safetyNumberFromKey,
  generateRoomKey,
  wrapRoomKeyForPeer,
  unwrapRoomKeyFromPeer,
} from "./index.ts";

describe("X25519 key agreement", () => {
  it("derives identical shared keys for both peers", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const roomId = "AB92KF";

    const keyA = deriveSharedKey(a.privateKey, b.publicKey, roomId);
    const keyB = deriveSharedKey(b.privateKey, a.publicKey, roomId);

    assert.equal(keyA.length, 32);
    assert.equal(keyB.length, 32);
    assert.deepEqual(keyA, keyB);
  });

  it("produces different keys for different roomIds", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const k1 = deriveSharedKey(a.privateKey, b.publicKey, "ROOM01");
    const k2 = deriveSharedKey(a.privateKey, b.publicKey, "ROOM02");
    assert.notDeepEqual(k1, k2);
  });

  it("round-trips public key base64", () => {
    const { publicKey } = generateKeyPair();
    const b64 = publicKeyToBase64(publicKey);
    const back = publicKeyFromBase64(b64);
    assert.deepEqual(back, publicKey);
  });
});

describe("XChaCha20-Poly1305 AEAD", () => {
  it("encrypts and decrypts plaintext", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const key = deriveSharedKey(a.privateKey, b.publicKey, "TESTROOM");
    const plain = "hello ghost — unicode 🔐 こんにちは";

    const { ciphertext, nonce } = encrypt(key, plain);
    assert.equal(nonce.length, 24);
    assert.ok(ciphertext.length > plain.length); // includes auth tag

    const out = decrypt(key, ciphertext, nonce);
    assert.equal(out, plain);
  });

  it("fails decrypt with wrong key", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const c = generateKeyPair();
    const keyOk = deriveSharedKey(a.privateKey, b.publicKey, "R1");
    const keyBad = deriveSharedKey(a.privateKey, c.publicKey, "R1");
    const { ciphertext, nonce } = encrypt(keyOk, "secret");

    assert.throws(() => decrypt(keyBad, ciphertext, nonce));
  });

  it("fails decrypt with tampered ciphertext", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const key = deriveSharedKey(a.privateKey, b.publicKey, "R1");
    const { ciphertext, nonce } = encrypt(key, "secret");
    const tampered = new Uint8Array(ciphertext);
    tampered[0] = (tampered[0]! + 1) % 256;

    assert.throws(() => decrypt(key, tampered, nonce));
  });

  it("uses unique nonces per encrypt", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const key = deriveSharedKey(a.privateKey, b.publicKey, "R1");
    const n1 = encrypt(key, "a").nonce;
    const n2 = encrypt(key, "a").nonce;
    assert.notDeepEqual(n1, n2);
  });
});

describe("safety number", () => {
  it("matches for both peers and differs across rooms", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const k1 = deriveSharedKey(a.privateKey, b.publicKey, "ROOM01");
    const k1b = deriveSharedKey(b.privateKey, a.publicKey, "ROOM01");
    const k2 = deriveSharedKey(a.privateKey, b.publicKey, "ROOM02");

    assert.equal(safetyNumberFromKey(k1), safetyNumberFromKey(k1b));
    assert.match(safetyNumberFromKey(k1), /^\d{5} \d{5} \d{5}$/);
    assert.notEqual(safetyNumberFromKey(k1), safetyNumberFromKey(k2));
  });
});

describe("group room key wrap", () => {
  it("wraps and unwraps room key between peers", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const roomKey = generateRoomKey();
    assert.equal(roomKey.length, 32);

    const wrapped = wrapRoomKeyForPeer(
      a.privateKey,
      b.publicKey,
      roomKey,
      "GRP001"
    );
    const unwrapped = unwrapRoomKeyFromPeer(
      b.privateKey,
      a.publicKey,
      wrapped.ciphertext,
      wrapped.nonce,
      "GRP001"
    );
    assert.deepEqual(unwrapped, roomKey);
  });
});

describe("wire encoding", () => {
  it("round-trips encryptToWire / decryptFromWire", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const key = deriveSharedKey(a.privateKey, b.publicKey, "WIRE01");
    const wire = encryptToWire(key, "payload over ws");
    assert.equal(typeof wire.ciphertext, "string");
    assert.equal(typeof wire.nonce, "string");
    assert.equal(decryptFromWire(key, wire.ciphertext, wire.nonce), "payload over ws");
  });

  it("round-trips base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  });
});
