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
  /**
   * Max application ciphertext (base64 length roughly 4/3 of plaintext).
   * Sized for compressed images (~280KB) inside MLS PrivateMessages.
   */
  maxCiphertextBytes: 512 * 1024,
  /** Max base64 size for MLS control frames (key package, welcome, commit). */
  maxMlsPayloadBytes: 96 * 1024,
  /** Max compressed image bytes before E2EE (JPEG/WebP). */
  maxImageBytes: 280 * 1024,
  /** Longest edge when client-resizing images before send. */
  maxImageEdgePx: 1280,
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

/**
 * Message self-destruct modes (client-side only; server never stores plaintext).
 * - `on_read` — burn shortly after recipient sees it
 * - `10s` / `60s` / `Ns` — burn after N seconds on screen
 * - `on_leave` — no timed autodelete; burn when the **sender** leaves the room
 */
export type TtlMode = "on_read" | "on_leave" | "10s" | "60s" | `${number}s`;

/** Timed TTL in ms, or null for non-timed modes (`on_read`, `on_leave`). */
export function parseTtlMs(mode: TtlMode): number | null {
  if (mode === "on_read" || mode === "on_leave") return null;
  const m = /^(\d+)s$/.exec(mode);
  if (!m) return null;
  return parseInt(m[1]!, 10) * 1000;
}

/** Keep until the sender leaves — no clock / on-read autodelete. */
export function isOnLeaveTtl(mode: TtlMode | string): boolean {
  return mode === "on_leave";
}

export function isValidTtlMode(mode: string): mode is TtlMode {
  if (
    mode === "on_read" ||
    mode === "on_leave" ||
    mode === "10s" ||
    mode === "60s"
  ) {
    return true;
  }
  const m = /^(\d+)s$/.exec(mode);
  if (!m) return false;
  const n = parseInt(m[1]!, 10);
  return n >= 1 && n <= 3600;
}

// --- Ephemeral image payloads (inside MLS app messages) ---

/** Magic prefix so receivers can distinguish text vs image app payloads. */
export const APP_IMAGE_PREFIX = "\u0001GCIMG1:" as const;

export type DecodedAppPayload =
  | { kind: "text"; text: string }
  | {
      kind: "image";
      mime: string;
      name: string;
      bytes: Uint8Array;
    };

function b64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function b64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Pack compressed image bytes into an MLS application plaintext string. */
export function encodeAppImage(
  mime: string,
  name: string,
  bytes: Uint8Array
): string {
  if (bytes.byteLength > LIMITS.maxImageBytes) {
    throw new Error(
      `Image too large (${bytes.byteLength} > ${LIMITS.maxImageBytes})`
    );
  }
  const safeMime =
    mime === "image/jpeg" || mime === "image/png" || mime === "image/webp"
      ? mime
      : "image/jpeg";
  const safeName = (name || "image").slice(0, 80).replace(/[^\w.\-()+ ]/g, "_");
  return (
    APP_IMAGE_PREFIX +
    JSON.stringify({
      mime: safeMime,
      name: safeName,
      data: b64Encode(bytes),
    })
  );
}

/** Parse MLS application plaintext into text or image. */
export function decodeAppPayload(text: string): DecodedAppPayload {
  if (!text.startsWith(APP_IMAGE_PREFIX)) {
    return { kind: "text", text };
  }
  try {
    const raw = JSON.parse(text.slice(APP_IMAGE_PREFIX.length)) as {
      mime?: string;
      name?: string;
      data?: string;
    };
    if (typeof raw.data !== "string" || !raw.data) {
      return { kind: "text", text: "[invalid image]" };
    }
    const bytes = b64Decode(raw.data);
    if (bytes.byteLength > LIMITS.maxImageBytes * 1.1) {
      return { kind: "text", text: "[image too large]" };
    }
    return {
      kind: "image",
      mime:
        raw.mime === "image/png" || raw.mime === "image/webp"
          ? raw.mime
          : "image/jpeg",
      name: typeof raw.name === "string" ? raw.name.slice(0, 80) : "image",
      bytes,
    };
  } catch {
    return { kind: "text", text: "[invalid image]" };
  }
}
