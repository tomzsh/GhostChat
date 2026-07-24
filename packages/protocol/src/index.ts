import { LIMITS, type TtlMode } from "@ghostchat/shared";

/** Wire protocol major version — v2 = MLS group E2EE. */
export const PROTOCOL_VERSION = 2 as const;

export type ErrorCode =
  | "room_full"
  | "room_not_found"
  | "rate_limited"
  | "invalid_payload"
  | "room_closed";

export type RoomClosedReason =
  | "peer_left"
  | "idle_timeout"
  | "max_age"
  | "empty";

/** Peer identity as seen on the wire (MLS uses separate key packages). */
export type PeerInfo = {
  id: string;
  /** Legacy / optional; may be empty or "mls" under protocol v2. */
  publicKey: string;
};

/** Client → Server */
export type ClientMessage =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "join";
      displayId: string;
      /** Optional under v2; keep for DO presence validation. */
      publicKey: string;
      sessionToken?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "message";
      /** Base64 MLS PrivateMessage (application). */
      ciphertext: string;
      /** Marker `"mls"` for MLS app messages. */
      nonce: string;
      ttlMode: TtlMode;
      messageId: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "typing";
      state: boolean;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "burn";
      messageId: string;
    }
  /** MLS KeyPackage for joiners (broadcast). */
  | {
      v: typeof PROTOCOL_VERSION;
      type: "mls_key_package";
      package: string;
    }
  /** MLS Welcome targeted at a joiner. */
  | {
      v: typeof PROTOCOL_VERSION;
      type: "mls_welcome";
      to: string;
      welcome: string;
    }
  /** MLS Commit (Add/Remove/…) for all members. */
  | {
      v: typeof PROTOCOL_VERSION;
      type: "mls_commit";
      commit: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ping";
    }
  /** Explicit leave — server rotates invite before socket dies. */
  | {
      v: typeof PROTOCOL_VERSION;
      type: "leave";
    };

/** Server → Client */
export type ServerMessage =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "joined";
      yourId: string;
      sessionToken: string;
      maxParticipants: number;
      participantCount: number;
      peers: PeerInfo[];
      /** @deprecated first peer only — use peers[] */
      peerId: string | null;
      peerPublicKey: string | null;
      /** Stable Durable Object / WS id (does not rotate). */
      internalId?: string;
      /** Current shareable invite code (may differ from internalId). */
      publicCode?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "peer_joined";
      peerId: string;
      peerPublicKey: string;
      participantCount: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "peer_left";
      peerId: string;
      participantCount: number;
      /** New invite code after rotation (remaining peers only). */
      publicCode?: string;
    }
  /** Invite code rotated after a member left — remaining peers update share/QR. */
  | {
      v: typeof PROTOCOL_VERSION;
      type: "room_code";
      /** New public invite code (WS may still use stable internal room id). */
      publicCode: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "message";
      from: string;
      ciphertext: string;
      nonce: string;
      ttlMode: TtlMode;
      messageId: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "typing";
      from: string;
      state: boolean;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "burn";
      messageId: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "mls_key_package";
      from: string;
      package: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "mls_welcome";
      from: string;
      to: string;
      welcome: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "mls_commit";
      from: string;
      commit: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "error";
      code: ErrorCode;
      message?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "room_closed";
      reason: RoomClosedReason;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "pong";
    };

export type RoomStatusResponse =
  | {
      status: "ok";
      /** Public invite code (may differ from internal DO id after rotation). */
      roomId: string;
      /** Stable Durable Object / WS id — clients keep this for the socket. */
      internalId?: string;
      participantCount: number;
      maxParticipants: number;
      full: boolean;
    }
  | { status: "not_found" }
  | { status: "full"; roomId: string; maxParticipants?: number };

export type CreateRoomRequest = {
  maxParticipants?: number;
};

export type CreateRoomResponse = {
  roomId: string;
  wsUrl: string;
  maxParticipants: number;
};

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.v !== PROTOCOL_VERSION || typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "join":
      if (typeof msg.displayId !== "string") return null;
      return {
        v: PROTOCOL_VERSION,
        type: "join",
        displayId: msg.displayId,
        publicKey: typeof msg.publicKey === "string" ? msg.publicKey : "mls",
        sessionToken:
          typeof msg.sessionToken === "string" ? msg.sessionToken : undefined,
      };
    case "message":
      if (
        !isNonEmptyString(msg.ciphertext, LIMITS.maxCiphertextBytes) ||
        typeof msg.nonce !== "string" ||
        typeof msg.ttlMode !== "string" ||
        typeof msg.messageId !== "string"
      )
        return null;
      return {
        v: PROTOCOL_VERSION,
        type: "message",
        ciphertext: msg.ciphertext,
        nonce: msg.nonce,
        ttlMode: msg.ttlMode as TtlMode,
        messageId: msg.messageId,
      };
    case "typing":
      if (typeof msg.state !== "boolean") return null;
      return { v: PROTOCOL_VERSION, type: "typing", state: msg.state };
    case "burn":
      if (typeof msg.messageId !== "string") return null;
      return {
        v: PROTOCOL_VERSION,
        type: "burn",
        messageId: msg.messageId,
      };
    case "mls_key_package":
      if (!isNonEmptyString(msg.package, 96_000)) return null;
      return {
        v: PROTOCOL_VERSION,
        type: "mls_key_package",
        package: msg.package,
      };
    case "mls_welcome":
      if (
        typeof msg.to !== "string" ||
        !isNonEmptyString(msg.welcome, 96_000)
      )
        return null;
      return {
        v: PROTOCOL_VERSION,
        type: "mls_welcome",
        to: msg.to,
        welcome: msg.welcome,
      };
    case "mls_commit":
      if (!isNonEmptyString(msg.commit, 96_000)) return null;
      return {
        v: PROTOCOL_VERSION,
        type: "mls_commit",
        commit: msg.commit,
      };
    case "ping":
      return { v: PROTOCOL_VERSION, type: "ping" };
    case "leave":
      return { v: PROTOCOL_VERSION, type: "leave" };
    default:
      return null;
  }
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.v !== PROTOCOL_VERSION || typeof msg.type !== "string") return null;
  return msg as unknown as ServerMessage;
}
