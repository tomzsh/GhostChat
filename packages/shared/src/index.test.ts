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
