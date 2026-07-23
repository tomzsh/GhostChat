/** Alphabet without ambiguous chars: 0/O, 1/I */
export const SAFE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomChars(length: number, alphabet = SAFE_ALPHABET): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Room code: 6 uppercase alphanumeric, no ambiguous chars */
export function generateRoomId(): string {
  return randomChars(6);
}

/** Display ID: Anon-XXXX */
export function generateDisplayId(): string {
  return `Anon-${randomChars(4)}`;
}

/** Client-side message id (not security-sensitive) */
export function generateMessageId(): string {
  return `m_${randomChars(10)}`;
}

export function isValidRoomId(id: string): boolean {
  if (id.length !== 6) return false;
  for (const c of id.toUpperCase()) {
    if (!SAFE_ALPHABET.includes(c)) return false;
  }
  return true;
}

export function normalizeRoomId(id: string): string {
  return id.trim().toUpperCase();
}

/** Runtime limits */
export const LIMITS = {
  /** Hard ceiling for room size (creator cannot exceed this). */
  maxParticipantsCap: 20,
  /** Default room size when creator does not specify. */
  defaultMaxParticipants: 2,
  /** Minimum room size (always at least a pair possible). */
  minMaxParticipants: 2,
  /** @deprecated use maxParticipantsCap — kept for older imports */
  maxParticipants: 20,
  maxMessagesPerSecond: 5,
  /** MLS PrivateMessage / Welcome / Commit can exceed small AEAD blobs. */
  maxCiphertextBytes: 48 * 1024,
  /** Max base64 size for MLS control frames (key package, welcome, commit). */
  maxMlsPayloadBytes: 96 * 1024,
  idleTimeoutMs: 10 * 60 * 1000,
  maxAgeMs: 24 * 60 * 60 * 1000,
  reconnectGraceMs: 30 * 1000,
  maxCreatesPerMinute: 10,
  maxJoinProbesPerMinute: 30,
  rateLimitWindowMs: 60_000,
} as const;

/** Clamp creator-provided max participants into allowed range. */
export function clampMaxParticipants(n: unknown): number {
  const raw =
    typeof n === "number"
      ? n
      : typeof n === "string"
        ? parseInt(n, 10)
        : LIMITS.defaultMaxParticipants;
  if (!Number.isFinite(raw)) return LIMITS.defaultMaxParticipants;
  const v = Math.floor(raw);
  if (v < LIMITS.minMaxParticipants) return LIMITS.minMaxParticipants;
  if (v > LIMITS.maxParticipantsCap) return LIMITS.maxParticipantsCap;
  return v;
}

export type TtlMode = "on_read" | "10s" | "60s" | `${number}s`;

export function parseTtlMs(mode: TtlMode): number | null {
  if (mode === "on_read") return null;
  const m = /^(\d+)s$/.exec(mode);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 1000;
}

export function isValidTtlMode(mode: string): mode is TtlMode {
  if (mode === "on_read" || mode === "10s" || mode === "60s") return true;
  const m = /^(\d+)s$/.exec(mode);
  if (!m) return false;
  const n = parseInt(m[1]!, 10);
  return n >= 1 && n <= 3600;
}
