import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowLimiter } from "./rateLimit.js";

describe("SlidingWindowLimiter", () => {
  it("allows up to max hits then blocks", () => {
    const lim = new SlidingWindowLimiter(3, 60_000);
    const t0 = 1_000_000;
    assert.equal(lim.allow("ip", t0), true);
    assert.equal(lim.allow("ip", t0 + 1), true);
    assert.equal(lim.allow("ip", t0 + 2), true);
    assert.equal(lim.allow("ip", t0 + 3), false);
  });

  it("resets after window elapses", () => {
    const lim = new SlidingWindowLimiter(2, 1000);
    const t0 = 1_000_000;
    assert.equal(lim.allow("a", t0), true);
    assert.equal(lim.allow("a", t0 + 100), true);
    assert.equal(lim.allow("a", t0 + 200), false);
    assert.equal(lim.allow("a", t0 + 1100), true);
  });

  it("isolates keys", () => {
    const lim = new SlidingWindowLimiter(1, 60_000);
    const t0 = 1_000_000;
    assert.equal(lim.allow("a", t0), true);
    assert.equal(lim.allow("a", t0 + 1), false);
    assert.equal(lim.allow("b", t0 + 1), true);
  });
});
