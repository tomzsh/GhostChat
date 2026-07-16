/**
 * Simple sliding-window rate limiter for a single Worker isolate.
 * Not globally coordinated across edges — good enough to blunt brute-force
 * of room codes and create spam on free/dev tiers.
 */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly maxHits: number,
    private readonly windowMs: number
  ) {}

  /** Returns true if the request is allowed. */
  allow(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    let list = this.hits.get(key);
    if (!list) {
      list = [];
      this.hits.set(key, list);
    }
    // Drop expired timestamps
    while (list.length > 0 && list[0]! < cutoff) list.shift();
    if (list.length >= this.maxHits) return false;
    list.push(now);
    // Bound map growth: prune idle keys occasionally
    if (this.hits.size > 5000) this.gc(now);
    return true;
  }

  private gc(now: number) {
    const cutoff = now - this.windowMs;
    for (const [k, list] of this.hits) {
      while (list.length > 0 && list[0]! < cutoff) list.shift();
      if (list.length === 0) this.hits.delete(k);
    }
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
