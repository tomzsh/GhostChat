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
   * Max wire ciphertext string length (base64 MLS PrivateMessage).
   * Chunked images keep each frame well under this; legacy single-frame still allowed.
   */
  maxCiphertextBytes: 2.5 * 1024 * 1024,
  /** Max base64 size for MLS control frames (key package, welcome, commit). */
  maxMlsPayloadBytes: 96 * 1024,
  /** Max compressed image bytes before E2EE (JPEG/WebP). */
  maxImageBytes: 1024 * 1024,
  /** Max ephemeral file bytes before E2EE (any type, downloadable). */
  maxFileBytes: 1024 * 1024,
  /** Longest edge when client-resizing images before send. */
  maxImageEdgePx: 1920,
  /**
   * Raw binary bytes per blob chunk (before base64 + MLS).
   * Keeps each WS frame small for stable relay under rate limits.
   */
  imageChunkBytes: 24 * 1024,
  /** Drop incomplete image/file transfers after this many ms. */
  imageTransferTtlMs: 90_000,
  /**
   * Min delay between blob chunk WS sends (ms).
   * Stays under maxMessagesPerSecond with headroom.
   */
  imageChunkSendGapMs: 220,
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

/** Magic prefixes for structured MLS application payloads. */
export const APP_IMAGE_PREFIX = "\u0001GCIMG1:" as const;
/** Chunked image frames (stable multi-message transfer). */
export const APP_IMAGE_CHUNK_PREFIX = "\u0001GCIMGC1:" as const;
/** Chunked file frames (downloadable, any mime ≤ maxFileBytes). */
export const APP_FILE_CHUNK_PREFIX = "\u0001GCFILE1:" as const;
export const APP_EMOJI_PREFIX = "\u0001GCEMO1:" as const;

/** Built-in animated ASCII emote ids (frames live on clients). */
export const ASCII_EMOJI_IDS = [
  "wave",
  "heart",
  "fire",
  "ghost",
  "lol",
  "thumbsup",
  "party",
  "skull",
  "coffee",
  "cry",
  "cool",
  "think",
  // v2.5+ expanded set
  "rocket",
  "matrix",
  "glitch",
  "dance",
  "shrug",
  "rage",
  "robot",
  "cat",
  "star",
  "moon",
  "rain",
  "boom",
  "ninja",
  "alien",
  "bongo",
  "spinner",
  "ok",
  "nope",
  "sparkle",
  "eyes",
  "clap",
  "facepalm",
  "wink",
  "sleepy",
  "money",
  "pizza",
  "hacker",
  "terminal",
  "love",
  "zombie",
  "wizard",
  "keyboard",
] as const;

export type AsciiEmojiId = (typeof ASCII_EMOJI_IDS)[number];

export function isAsciiEmojiId(id: string): id is AsciiEmojiId {
  return (ASCII_EMOJI_IDS as readonly string[]).includes(id);
}

export type DecodedAppPayload =
  | { kind: "text"; text: string }
  | {
      kind: "image";
      mime: string;
      name: string;
      bytes: Uint8Array;
    }
  | {
      kind: "file";
      mime: string;
      name: string;
      bytes: Uint8Array;
    }
  | {
      kind: "image_part";
      /** Transfer id (shared across chunks; used as final chat message id). */
      id: string;
      /** 0-based part index. */
      i: number;
      /** Total parts. */
      n: number;
      mime?: string;
      name?: string;
      /** Total image byte length (part 0). */
      len?: number;
      data: Uint8Array;
    }
  | {
      kind: "file_part";
      id: string;
      i: number;
      n: number;
      mime?: string;
      name?: string;
      len?: number;
      data: Uint8Array;
    }
  | { kind: "emoji"; id: AsciiEmojiId };

/** Chunked binary→base64 (avoids huge call stacks / quadratic string growth). */
function b64Encode(bytes: Uint8Array): string {
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    let piece = "";
    for (let j = i; j < end; j++) {
      piece += String.fromCharCode(bytes[j]!);
    }
    binary += piece;
  }
  return btoa(binary);
}

function b64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Force non-executable download MIME (mitigate HTML/SVG open-as-page). */
export function safeDownloadMime(mime: string): string {
  const m = (mime || "").toLowerCase().trim();
  if (
    !m ||
    m === "text/html" ||
    m === "image/svg+xml" ||
    m === "application/xhtml+xml" ||
    m.startsWith("text/javascript") ||
    m === "application/javascript" ||
    m === "application/x-javascript"
  ) {
    return "application/octet-stream";
  }
  return m.slice(0, 120);
}

function safeImageMime(mime: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mime === "image/png" || mime === "image/webp" || mime === "image/jpeg") {
    return mime;
  }
  return "image/jpeg";
}

function safeImageName(name: string): string {
  return (name || "image").slice(0, 80).replace(/[^\w.\-()+ ]/g, "_");
}

function safeFileMime(mime: string): string {
  if (!mime || mime.length > 120) return "application/octet-stream";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) {
    return "application/octet-stream";
  }
  return mime.slice(0, 120);
}

function safeFileName(name: string): string {
  return (name || "file").slice(0, 120).replace(/[^\w.\-()+ ]/g, "_") || "file";
}

/** Pack compressed image bytes into a single MLS application plaintext (legacy). */
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
  return (
    APP_IMAGE_PREFIX +
    JSON.stringify({
      mime: safeImageMime(mime),
      name: safeImageName(name),
      data: b64Encode(bytes),
    })
  );
}

/**
 * Split a compressed image into small MLS plaintexts for stable multi-frame send.
 * Part 0 carries mime + name; all parts share `transferId`.
 */
export function encodeAppImageChunks(
  transferId: string,
  mime: string,
  name: string,
  bytes: Uint8Array,
  chunkSize: number = LIMITS.imageChunkBytes
): string[] {
  if (!transferId || transferId.length > 64) {
    throw new Error("Invalid transfer id");
  }
  if (bytes.byteLength < 1) throw new Error("Empty image");
  if (bytes.byteLength > LIMITS.maxImageBytes) {
    throw new Error(
      `Image too large (${bytes.byteLength} > ${LIMITS.maxImageBytes})`
    );
  }
  const size = Math.max(1024, Math.min(chunkSize, LIMITS.imageChunkBytes * 2));
  const n = Math.ceil(bytes.byteLength / size);
  const safeMime = safeImageMime(mime);
  const safeName = safeImageName(name);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * size;
    const slice = bytes.subarray(start, Math.min(start + size, bytes.byteLength));
    const frame: Record<string, unknown> = {
      id: transferId,
      i,
      n,
      d: b64Encode(slice),
    };
    if (i === 0) {
      frame.mime = safeMime;
      frame.name = safeName;
      frame.len = bytes.byteLength;
    }
    out.push(APP_IMAGE_CHUNK_PREFIX + JSON.stringify(frame));
  }
  return out;
}

export type ImageTransferProgress =
  | { status: "pending"; id: string; received: number; total: number }
  | {
      status: "complete";
      id: string;
      mime: string;
      name: string;
      bytes: Uint8Array;
    }
  | { status: "error"; id: string; reason: string };

type PendingTransfer = {
  n: number;
  len?: number;
  mime?: string;
  name?: string;
  parts: Map<number, Uint8Array>;
  updatedAt: number;
};

type AssemblerMode = "image" | "file";

/**
 * Reassemble chunked image or file frames (in-memory, ephemeral).
 * Use mode `"file"` for downloadable blobs (any mime ≤ maxFileBytes).
 */
export class ImageTransferAssembler {
  private pending = new Map<string, PendingTransfer>();
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly mode: AssemblerMode;

  constructor(
    ttlMsOrOpts:
      | number
      | { ttlMs?: number; maxBytes?: number; mode?: AssemblerMode } = LIMITS.imageTransferTtlMs
  ) {
    if (typeof ttlMsOrOpts === "number") {
      this.ttlMs = ttlMsOrOpts;
      this.maxBytes = LIMITS.maxImageBytes;
      this.mode = "image";
    } else {
      this.ttlMs = ttlMsOrOpts.ttlMs ?? LIMITS.imageTransferTtlMs;
      this.mode = ttlMsOrOpts.mode ?? "image";
      this.maxBytes =
        ttlMsOrOpts.maxBytes ??
        (this.mode === "file" ? LIMITS.maxFileBytes : LIMITS.maxImageBytes);
    }
  }

  clear() {
    this.pending.clear();
  }

  /** Drop stale incomplete transfers. */
  gc(now = Date.now()) {
    for (const [id, t] of this.pending) {
      if (now - t.updatedAt > this.ttlMs) this.pending.delete(id);
    }
  }

  /**
   * Ingest one decoded image_part / file_part. Returns progress / complete blob.
   */
  ingest(part: {
    id: string;
    i: number;
    n: number;
    mime?: string;
    name?: string;
    data: Uint8Array;
    len?: number;
  }): ImageTransferProgress {
    this.gc();
    const { id, i, n, data } = part;
    if (!id || n < 1 || n > 256 || i < 0 || i >= n) {
      return { status: "error", id, reason: "invalid chunk" };
    }
    if (data.byteLength > LIMITS.imageChunkBytes * 2) {
      return { status: "error", id, reason: "chunk too large" };
    }

    let t = this.pending.get(id);
    if (!t) {
      t = {
        n,
        parts: new Map(),
        updatedAt: Date.now(),
        mime: part.mime,
        name: part.name,
        len: part.len,
      };
      this.pending.set(id, t);
    } else if (t.n !== n) {
      this.pending.delete(id);
      return { status: "error", id, reason: "chunk count mismatch" };
    }

    t.updatedAt = Date.now();
    if (part.mime) t.mime = part.mime;
    if (part.name) t.name = part.name;
    if (typeof part.len === "number") t.len = part.len;
    t.parts.set(i, data);

    if (t.parts.size < n) {
      return { status: "pending", id, received: t.parts.size, total: n };
    }

    // Reassemble in order
    let total = 0;
    for (let k = 0; k < n; k++) {
      const p = t.parts.get(k);
      if (!p) {
        return { status: "pending", id, received: t.parts.size, total: n };
      }
      total += p.byteLength;
    }
    if (total > this.maxBytes * 1.1) {
      this.pending.delete(id);
      return { status: "error", id, reason: "blob too large" };
    }
    if (t.len !== undefined && t.len !== total) {
      this.pending.delete(id);
      return { status: "error", id, reason: "length mismatch" };
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (let k = 0; k < n; k++) {
      const p = t.parts.get(k)!;
      bytes.set(p, offset);
      offset += p.byteLength;
    }
    this.pending.delete(id);
    if (this.mode === "file") {
      return {
        status: "complete",
        id,
        mime: safeFileMime(t.mime || "application/octet-stream"),
        name: safeFileName(t.name || "file"),
        bytes,
      };
    }
    return {
      status: "complete",
      id,
      mime: safeImageMime(t.mime || "image/jpeg"),
      name: safeImageName(t.name || "image"),
      bytes,
    };
  }
}

/** Assembler for downloadable file transfers. */
export function createFileTransferAssembler(): ImageTransferAssembler {
  return new ImageTransferAssembler({
    mode: "file",
    maxBytes: LIMITS.maxFileBytes,
  });
}

/**
 * Split a file into small MLS plaintexts for stable multi-frame send.
 * Part 0 carries mime + name; all parts share `transferId`.
 */
export function encodeAppFileChunks(
  transferId: string,
  mime: string,
  name: string,
  bytes: Uint8Array,
  chunkSize: number = LIMITS.imageChunkBytes
): string[] {
  if (!transferId || transferId.length > 64) {
    throw new Error("Invalid transfer id");
  }
  if (bytes.byteLength < 1) throw new Error("Empty file");
  if (bytes.byteLength > LIMITS.maxFileBytes) {
    throw new Error(
      `File too large (${bytes.byteLength} > ${LIMITS.maxFileBytes})`
    );
  }
  const size = Math.max(1024, Math.min(chunkSize, LIMITS.imageChunkBytes * 2));
  const n = Math.ceil(bytes.byteLength / size);
  const safeMime = safeFileMime(mime);
  const safeName = safeFileName(name);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * size;
    const slice = bytes.subarray(start, Math.min(start + size, bytes.byteLength));
    const frame: Record<string, unknown> = {
      id: transferId,
      i,
      n,
      d: b64Encode(slice),
    };
    if (i === 0) {
      frame.mime = safeMime;
      frame.name = safeName;
      frame.len = bytes.byteLength;
    }
    out.push(APP_FILE_CHUNK_PREFIX + JSON.stringify(frame));
  }
  return out;
}

/** Pack an animated ASCII emote id into an MLS application plaintext. */
export function encodeAppEmoji(id: AsciiEmojiId | string): string {
  if (!isAsciiEmojiId(id)) throw new Error("Unknown ASCII emoji");
  return APP_EMOJI_PREFIX + JSON.stringify({ id });
}

/** Parse MLS application plaintext into text, image, chunk, or emoji. */
export function decodeAppPayload(text: string): DecodedAppPayload {
  if (text.startsWith(APP_EMOJI_PREFIX)) {
    try {
      const raw = JSON.parse(text.slice(APP_EMOJI_PREFIX.length)) as {
        id?: string;
      };
      if (typeof raw.id === "string" && isAsciiEmojiId(raw.id)) {
        return { kind: "emoji", id: raw.id };
      }
      return { kind: "text", text: "[unknown emoji]" };
    } catch {
      return { kind: "text", text: "[invalid emoji]" };
    }
  }

  if (text.startsWith(APP_IMAGE_CHUNK_PREFIX)) {
    try {
      const raw = JSON.parse(text.slice(APP_IMAGE_CHUNK_PREFIX.length)) as {
        id?: string;
        i?: number;
        n?: number;
        mime?: string;
        name?: string;
        d?: string;
        len?: number;
      };
      if (
        typeof raw.id !== "string" ||
        typeof raw.i !== "number" ||
        typeof raw.n !== "number" ||
        typeof raw.d !== "string" ||
        !raw.d
      ) {
        return { kind: "text", text: "[invalid image chunk]" };
      }
      const data = b64Decode(raw.d);
      return {
        kind: "image_part",
        id: raw.id.slice(0, 64),
        i: raw.i | 0,
        n: raw.n | 0,
        mime: typeof raw.mime === "string" ? raw.mime : undefined,
        name: typeof raw.name === "string" ? raw.name : undefined,
        len: typeof raw.len === "number" ? raw.len : undefined,
        data,
      };
    } catch {
      return { kind: "text", text: "[invalid image chunk]" };
    }
  }

  if (text.startsWith(APP_FILE_CHUNK_PREFIX)) {
    try {
      const raw = JSON.parse(text.slice(APP_FILE_CHUNK_PREFIX.length)) as {
        id?: string;
        i?: number;
        n?: number;
        mime?: string;
        name?: string;
        d?: string;
        len?: number;
      };
      if (
        typeof raw.id !== "string" ||
        typeof raw.i !== "number" ||
        typeof raw.n !== "number" ||
        typeof raw.d !== "string" ||
        !raw.d
      ) {
        return { kind: "text", text: "[invalid file chunk]" };
      }
      const data = b64Decode(raw.d);
      return {
        kind: "file_part",
        id: raw.id.slice(0, 64),
        i: raw.i | 0,
        n: raw.n | 0,
        mime: typeof raw.mime === "string" ? raw.mime : undefined,
        name: typeof raw.name === "string" ? raw.name : undefined,
        len: typeof raw.len === "number" ? raw.len : undefined,
        data,
      };
    } catch {
      return { kind: "text", text: "[invalid file chunk]" };
    }
  }

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
      mime: safeImageMime(raw.mime || "image/jpeg"),
      name: safeImageName(typeof raw.name === "string" ? raw.name : "image"),
      bytes,
    };
  } catch {
    return { kind: "text", text: "[invalid image]" };
  }
}
