import type { TtlMode } from "@ghostchat/shared";

export const PROTOCOL_VERSION = 1 as const;

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

/** Peer identity + public key as seen on the wire */
export type PeerInfo = {
  id: string;
  publicKey: string;
};

/** Client → Server */
export type ClientMessage =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "join";
      displayId: string;
      publicKey: string;
      sessionToken?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "message";
      ciphertext: string;
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
  /** Wrap room AEAD key for a specific peer (ECDH-encrypted). */
  | {
      v: typeof PROTOCOL_VERSION;
      type: "key_share";
      to: string;
      ciphertext: string;
      nonce: string;
    }
  /** Ask existing members to (re)send key_share to me. */
  | {
      v: typeof PROTOCOL_VERSION;
      type: "key_request";
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ping";
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
      /** All other members already in the room */
      peers: PeerInfo[];
      /** @deprecated first peer only — use peers[] */
      peerId: string | null;
      peerPublicKey: string | null;
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
      type: "key_share";
      from: string;
      to: string;
      ciphertext: string;
      nonce: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "key_request";
      from: string;
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
      roomId: string;
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

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.v !== PROTOCOL_VERSION || typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "join":
      if (typeof msg.displayId !== "string" || typeof msg.publicKey !== "string")
        return null;
      return {
        v: PROTOCOL_VERSION,
        type: "join",
        displayId: msg.displayId,
        publicKey: msg.publicKey,
        sessionToken:
          typeof msg.sessionToken === "string" ? msg.sessionToken : undefined,
      };
    case "message":
      if (
        typeof msg.ciphertext !== "string" ||
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
    case "key_share":
      if (
        typeof msg.to !== "string" ||
        typeof msg.ciphertext !== "string" ||
        typeof msg.nonce !== "string"
      )
        return null;
      return {
        v: PROTOCOL_VERSION,
        type: "key_share",
        to: msg.to,
        ciphertext: msg.ciphertext,
        nonce: msg.nonce,
      };
    case "key_request":
      return { v: PROTOCOL_VERSION, type: "key_request" };
    case "ping":
      return { v: PROTOCOL_VERSION, type: "ping" };
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
