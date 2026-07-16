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
      peerId: string | null;
      peerPublicKey: string | null;
      sessionToken: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "peer_joined";
      peerId: string;
      peerPublicKey: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "peer_left";
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
  | { status: "ok"; roomId: string; participantCount: number; full: boolean }
  | { status: "not_found" }
  | { status: "full"; roomId: string };

export type CreateRoomResponse = {
  roomId: string;
  wsUrl: string;
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
  // Trust shape from our server; clients still switch on type
  return msg as unknown as ServerMessage;
}
