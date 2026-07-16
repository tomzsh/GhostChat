import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
} from "@ghostchat/protocol";
import {
  LIMITS,
  generateDisplayId,
  isValidTtlMode,
  randomChars,
} from "@ghostchat/shared";

type Attachment = {
  displayId: string;
  publicKey: string;
  sessionToken: string;
  joinedAt: number;
  messageTimestamps: number[];
};

const ALARM_IDLE = "idle";
const ALARM_MAX_AGE = "max_age";
const X25519_PUB_BYTES = 32;

function isLiveAttachment(a: Attachment | null | undefined): a is Attachment {
  return !!a && !a.sessionToken.endsWith("__replaced");
}

/** X25519 public keys are 32 raw bytes (base64 ≈ 44 chars with padding). */
function isValidPublicKeyB64(b64: string): boolean {
  if (!b64 || b64.length < 40 || b64.length > 64) return false;
  try {
    const bin = atob(b64);
    return bin.length === X25519_PUB_BYTES;
  } catch {
    return false;
  }
}

/**
 * One Durable Object = one room. Relays ciphertext only; never stores messages.
 * Uses WebSocket Hibernation API so the DO can sleep between events.
 */
export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  private roomId = "";
  private createdAt = 0;
  private initialized = false;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const meta = await this.state.storage.get<{
        roomId: string;
        createdAt: number;
      }>("meta");
      if (meta) {
        this.roomId = meta.roomId;
        this.createdAt = meta.createdAt;
        this.initialized = true;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Internal: ensure room exists (called from create)
    if (path === "/init" && request.method === "POST") {
      const body = (await request.json()) as { roomId: string };
      if (!this.initialized) {
        this.roomId = body.roomId;
        this.createdAt = Date.now();
        this.initialized = true;
        await this.state.storage.put("meta", {
          roomId: this.roomId,
          createdAt: this.createdAt,
        });
        await this.state.storage.setAlarm(Date.now() + LIMITS.maxAgeMs);
        await this.state.storage.put("alarmKind", ALARM_MAX_AGE);
      }
      return Response.json({ ok: true, roomId: this.roomId });
    }

    if (path === "/status" && request.method === "GET") {
      if (!this.initialized) {
        return Response.json({ status: "not_found" });
      }
      // Unique sessions — not raw sockets (Strict Mode can open 2 sockets briefly)
      const count = this.uniqueSessions().size;
      return Response.json({
        status: "ok",
        roomId: this.roomId,
        participantCount: count,
        full: count >= LIMITS.maxParticipants,
      });
    }

    if (path === "/ws") {
      if (!this.initialized) {
        return new Response(JSON.stringify({ error: "room_not_found" }), {
          status: 404,
        });
      }

      if (this.isPastMaxAge()) {
        await this.closeRoom("max_age");
        return new Response(JSON.stringify({ error: "room_not_found" }), {
          status: 404,
        });
      }

      const upgrade = request.headers.get("Upgrade")?.toLowerCase();
      if (upgrade !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      // Hibernation: accept without tags first; attach after join
      this.state.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "Binary frames not supported",
      });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
      });
      return;
    }

    const msg = parseClientMessage(raw);
    if (!msg) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
      });
      return;
    }

    const attachment = this.getAttachment(ws);

    switch (msg.type) {
      case "join":
        await this.handleJoin(ws, msg.displayId, msg.publicKey, msg.sessionToken);
        break;
      case "message":
        if (!attachment) return;
        this.handleMessage(ws, attachment, msg);
        break;
      case "typing":
        if (!attachment) return;
        this.broadcast(
          ws,
          {
            v: PROTOCOL_VERSION,
            type: "typing",
            from: attachment.displayId,
            state: msg.state,
          },
          true
        );
        break;
      case "burn":
        if (!attachment) return;
        this.broadcast(
          ws,
          {
            v: PROTOCOL_VERSION,
            type: "burn",
            messageId: msg.messageId,
          },
          true
        );
        break;
      case "ping":
        this.send(ws, { v: PROTOCOL_VERSION, type: "pong" });
        break;
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    await this.onSocketGone(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown) {
    try {
      ws.close(1011, "error");
    } catch {
      /* ignore */
    }
    await this.onSocketGone(ws);
  }

  async alarm() {
    const kind = (await this.state.storage.get<string>("alarmKind")) ?? ALARM_IDLE;

    if (kind === ALARM_MAX_AGE || this.isPastMaxAge()) {
      await this.closeRoom("max_age");
      return;
    }

    if (kind === "empty") {
      if (this.uniqueSessions().size === 0) {
        await this.closeRoom("empty");
      }
      return;
    }

    // Idle timeout
    const last =
      (await this.state.storage.get<number>("lastActivityAt")) ?? this.createdAt;
    if (Date.now() - last >= LIMITS.idleTimeoutMs) {
      await this.closeRoom("idle_timeout");
    } else {
      const remaining = LIMITS.idleTimeoutMs - (Date.now() - last);
      await this.state.storage.setAlarm(Date.now() + Math.max(remaining, 1000));
      await this.state.storage.put("alarmKind", ALARM_IDLE);
    }
  }

  private async handleJoin(
    ws: WebSocket,
    displayId: string,
    publicKey: string,
    sessionToken?: string
  ) {
    if (!isValidPublicKeyB64(publicKey)) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "Invalid public key",
      });
      ws.close(1008, "invalid_payload");
      return;
    }

    const token =
      sessionToken && sessionToken.length >= 8 && sessionToken.length <= 64
        ? sessionToken
        : randomChars(16);

    // Reconnect: drop prior sockets for this session (avoid double-count / false peer_left)
    for (const s of this.state.getWebSockets()) {
      if (s === ws) continue;
      const a = this.getAttachment(s);
      if (a && a.sessionToken === token) {
        try {
          a.sessionToken = `${token}__replaced`;
          this.setAttachment(s, a);
          s.close(1000, "replaced");
        } catch {
          /* ignore */
        }
      }
    }

    // Capacity = unique live sessions (not raw socket count)
    const sessions = this.uniqueSessions(ws);
    const isReturning = sessions.has(token);
    if (!isReturning && sessions.size >= LIMITS.maxParticipants) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "room_full",
      });
      ws.close(1008, "room_full");
      return;
    }

    const id =
      displayId && /^Anon-[A-Z2-9]{4}$/.test(displayId)
        ? displayId
        : generateDisplayId();

    const att: Attachment = {
      displayId: id,
      publicKey,
      sessionToken: token,
      joinedAt: Date.now(),
      messageTimestamps: [],
    };
    this.setAttachment(ws, att);

    // Find peer (other session)
    let peerId: string | null = null;
    let peerPublicKey: string | null = null;
    for (const s of this.joinedPeers(ws)) {
      const a = this.getAttachment(s);
      if (!a || a.sessionToken === token) continue;
      peerId = a.displayId;
      peerPublicKey = a.publicKey;
      break;
    }

    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: "joined",
      yourId: id,
      peerId,
      peerPublicKey,
      sessionToken: token,
    });

    // Notify every other live peer (updated public key on reconnect)
    if (peerId) {
      for (const peerWs of this.joinedPeers(ws)) {
        this.send(peerWs, {
          v: PROTOCOL_VERSION,
          type: "peer_joined",
          peerId: id,
          peerPublicKey: publicKey,
        });
      }
    }

    await this.touchActivity();
  }

  private handleMessage(
    ws: WebSocket,
    attachment: Attachment,
    msg: {
      ciphertext: string;
      nonce: string;
      ttlMode: string;
      messageId: string;
    }
  ) {
    // Rate limit
    const now = Date.now();
    attachment.messageTimestamps = attachment.messageTimestamps.filter(
      (t) => now - t < 1000
    );
    if (attachment.messageTimestamps.length >= LIMITS.maxMessagesPerSecond) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "rate_limited",
      });
      return;
    }
    attachment.messageTimestamps.push(now);
    this.setAttachment(ws, attachment);

    // Size limit (base64 is larger than raw; approximate)
    if (msg.ciphertext.length > LIMITS.maxCiphertextBytes * 2) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "Payload too large",
      });
      return;
    }

    if (!isValidTtlMode(msg.ttlMode)) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "Invalid ttlMode",
      });
      return;
    }

    // Only relay if peer is present (no server-side queue)
    const peers = this.joinedPeers(ws);
    if (peers.length === 0) {
      return;
    }

    for (const peer of peers) {
      this.send(peer, {
        v: PROTOCOL_VERSION,
        type: "message",
        from: attachment.displayId,
        ciphertext: msg.ciphertext,
        nonce: msg.nonce,
        ttlMode: msg.ttlMode as import("@ghostchat/shared").TtlMode,
        messageId: msg.messageId,
      });
    }

    void this.touchActivity();
  }

  private async onSocketGone(ws: WebSocket) {
    const att = this.getAttachment(ws);
    if (!att) return;

    // Replaced socket (reconnect) — do NOT send peer_left; that was clearing
    // the new connection's shared key and blocking send.
    if (att.sessionToken.endsWith("__replaced")) return;

    // Same session already present on another live socket?
    for (const s of this.state.getWebSockets()) {
      if (s === ws) continue;
      const a = this.getAttachment(s);
      if (a && a.sessionToken === att.sessionToken) return;
    }

    this.broadcast(ws, { v: PROTOCOL_VERSION, type: "peer_left" }, true);

    const remaining = this.state
      .getWebSockets()
      .filter((s) => {
        if (s === ws) return false;
        const a = this.getAttachment(s);
        return a !== null && !a.sessionToken.endsWith("__replaced");
      });

    if (remaining.length === 0) {
      await this.state.storage.put("emptySince", Date.now());
      await this.state.storage.setAlarm(Date.now() + LIMITS.reconnectGraceMs);
      await this.state.storage.put("alarmKind", "empty");
    }
  }

  /** Active session tokens excluding `except` socket. */
  private uniqueSessions(except?: WebSocket): Set<string> {
    const set = new Set<string>();
    for (const s of this.state.getWebSockets()) {
      if (except && s === except) continue;
      const a = this.getAttachment(s);
      if (!isLiveAttachment(a)) continue;
      set.add(a.sessionToken);
    }
    return set;
  }

  /** Live peer sockets that are fully joined (have attachment). */
  private joinedPeers(except?: WebSocket): WebSocket[] {
    const out: WebSocket[] = [];
    for (const s of this.state.getWebSockets()) {
      if (except && s === except) continue;
      if (isLiveAttachment(this.getAttachment(s))) out.push(s);
    }
    return out;
  }

  private async closeRoom(
    reason: "peer_left" | "idle_timeout" | "max_age" | "empty"
  ) {
    const msg: ServerMessage = {
      v: PROTOCOL_VERSION,
      type: "room_closed",
      reason: reason === "empty" ? "empty" : reason,
    };
    for (const s of this.state.getWebSockets()) {
      this.send(s, msg);
      try {
        s.close(1000, reason);
      } catch {
        /* ignore */
      }
    }
    await this.state.storage.deleteAll();
    this.initialized = false;
  }

  private isPastMaxAge(): boolean {
    return this.createdAt > 0 && Date.now() - this.createdAt >= LIMITS.maxAgeMs;
  }

  private async touchActivity() {
    const now = Date.now();
    await this.state.storage.put("lastActivityAt", now);
    // Don't override max_age alarm if closer
    const maxAgeAt = this.createdAt + LIMITS.maxAgeMs;
    const idleAt = now + LIMITS.idleTimeoutMs;
    if (idleAt < maxAgeAt) {
      await this.state.storage.setAlarm(idleAt);
      await this.state.storage.put("alarmKind", ALARM_IDLE);
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore closed */
    }
  }

  private broadcast(except: WebSocket, msg: ServerMessage, onlyJoined: boolean) {
    for (const s of this.state.getWebSockets()) {
      if (s === except) continue;
      if (onlyJoined && !isLiveAttachment(this.getAttachment(s))) continue;
      this.send(s, msg);
    }
  }

  private getAttachment(ws: WebSocket): Attachment | null {
    // Hibernation-safe: use serializeAttachment / deserializeAttachment
    try {
      const a = ws.deserializeAttachment() as Attachment | null;
      return a ?? null;
    } catch {
      return null;
    }
  }

  private setAttachment(ws: WebSocket, att: Attachment) {
    ws.serializeAttachment(att);
  }
}
