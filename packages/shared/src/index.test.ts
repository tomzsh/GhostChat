import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateRoomId,
  generateDisplayId,
  isValidRoomId,
  normalizeRoomId,
  isValidTtlMode,
  parseTtlMs,
  clampMaxParticipants,
  LIMITS,
  SAFE_ALPHABET,
} from "./index.ts";

describe("room ids", () => {
  it("generates 6-char safe codes", () => {
    for (let i = 0; i < 20; i++) {
      const id = generateRoomId();
      assert.equal(id.length, 6);
      assert.ok(isValidRoomId(id));
      for (const c of id) assert.ok(SAFE_ALPHABET.includes(c));
    }
  });

  it("rejects ambiguous / invalid codes", () => {
    assert.equal(isValidRoomId("ABCDEF"), true);
    assert.equal(isValidRoomId("ABCDE1"), false); // 1 ambiguous
    assert.equal(isValidRoomId("ABCDEO"), false); // O ambiguous
    assert.equal(isValidRoomId("ABC"), false);
    assert.equal(isValidRoomId(""), false);
  });

  it("normalizes room ids", () => {
    assert.equal(normalizeRoomId(" ab92kf "), "AB92KF");
  });

  it("generates Anon display ids", () => {
    const id = generateDisplayId();
    assert.match(id, /^Anon-[A-Z2-9]{4}$/);
  });
});

describe("ttl modes", () => {
  it("parses known modes", () => {
    assert.equal(parseTtlMs("on_read"), null);
    assert.equal(parseTtlMs("on_leave"), null);
    assert.equal(parseTtlMs("10s"), 10_000);
    assert.equal(parseTtlMs("60s"), 60_000);
  });

  it("validates modes", () => {
    assert.ok(isValidTtlMode("on_read"));
    assert.ok(isValidTtlMode("on_leave"));
    assert.ok(isValidTtlMode("10s"));
    assert.ok(isValidTtlMode("120s"));
    assert.equal(isValidTtlMode("0s"), false);
    assert.equal(isValidTtlMode("nope"), false);
  });
});

describe("app image payload", () => {
  it("round-trips image encode/decode", async () => {
    const { encodeAppImage, decodeAppPayload } = await import("./index.ts");
    const bytes = new Uint8Array([1, 2, 3, 4, 255, 0, 128]);
    const wire = encodeAppImage("image/jpeg", "test.jpg", bytes);
    const parsed = decodeAppPayload(wire);
    assert.equal(parsed.kind, "image");
    if (parsed.kind === "image") {
      assert.equal(parsed.mime, "image/jpeg");
      assert.equal(parsed.name, "test.jpg");
      assert.deepEqual(parsed.bytes, bytes);
    }
    assert.equal(decodeAppPayload("hello").kind, "text");
  });

  it("splits and reassembles chunked images", async () => {
    const {
      encodeAppImageChunks,
      decodeAppPayload,
      ImageTransferAssembler,
    } = await import("./index.ts");
    // ~50KB so multiple 24KB chunks
    const bytes = new Uint8Array(50_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    const frames = encodeAppImageChunks("m_testimg01", "image/jpeg", "x.jpg", bytes);
    assert.ok(frames.length >= 2);

    const asm = new ImageTransferAssembler();
    let complete: ReturnType<ImageTransferAssembler["ingest"]> | null = null;
    for (const frame of frames) {
      const decoded = decodeAppPayload(frame);
      assert.equal(decoded.kind, "image_part");
      if (decoded.kind !== "image_part") continue;
      complete = asm.ingest({
        id: decoded.id,
        i: decoded.i,
        n: decoded.n,
        mime: decoded.mime,
        name: decoded.name,
        len: decoded.len,
        data: decoded.data,
      });
    }
    assert.ok(complete);
    assert.equal(complete!.status, "complete");
    if (complete!.status === "complete") {
      assert.equal(complete.mime, "image/jpeg");
      assert.equal(complete.name, "x.jpg");
      assert.equal(complete.bytes.byteLength, bytes.byteLength);
      assert.deepEqual(complete.bytes, bytes);
    }
  });
});

describe("app file payload", () => {
  it("splits and reassembles chunked files", async () => {
    const {
      encodeAppFileChunks,
      decodeAppPayload,
      createFileTransferAssembler,
    } = await import("./index.ts");
    const bytes = new Uint8Array(40_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 0xff;
    const frames = encodeAppFileChunks(
      "m_testfile1",
      "application/pdf",
      "doc.pdf",
      bytes
    );
    assert.ok(frames.length >= 2);
    const asm = createFileTransferAssembler();
    let complete: ReturnType<ReturnType<typeof createFileTransferAssembler>["ingest"]> | null =
      null;
    for (const frame of frames) {
      const decoded = decodeAppPayload(frame);
      assert.equal(decoded.kind, "file_part");
      if (decoded.kind !== "file_part") continue;
      complete = asm.ingest({
        id: decoded.id,
        i: decoded.i,
        n: decoded.n,
        mime: decoded.mime,
        name: decoded.name,
        len: decoded.len,
        data: decoded.data,
      });
    }
    assert.ok(complete);
    assert.equal(complete!.status, "complete");
    if (complete!.status === "complete") {
      assert.equal(complete.mime, "application/pdf");
      assert.equal(complete.name, "doc.pdf");
      assert.deepEqual(complete.bytes, bytes);
    }
  });
});

describe("app emoji payload", () => {
  it("round-trips emoji encode/decode", async () => {
    const { encodeAppEmoji, decodeAppPayload, isAsciiEmojiId } = await import(
      "./index.ts"
    );
    assert.ok(isAsciiEmojiId("wave"));
    assert.ok(isAsciiEmojiId("rocket"));
    assert.ok(isAsciiEmojiId("matrix"));
    const wire = encodeAppEmoji("wave");
    const parsed = decodeAppPayload(wire);
    assert.equal(parsed.kind, "emoji");
    if (parsed.kind === "emoji") assert.equal(parsed.id, "wave");
  });
});

describe("max participants", () => {
  it("clamps into allowed range", () => {
    assert.equal(clampMaxParticipants(2), 2);
    assert.equal(clampMaxParticipants(8), 8);
    assert.equal(clampMaxParticipants(1), LIMITS.minMaxParticipants);
    assert.equal(clampMaxParticipants(999), LIMITS.maxParticipantsCap);
    assert.equal(clampMaxParticipants("5"), 5);
    assert.equal(clampMaxParticipants(undefined), LIMITS.defaultMaxParticipants);
  });
});
