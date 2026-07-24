import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
  type PeerInfo,
} from "@ghostchat/protocol";
import {
  LIMITS,
  generateDisplayId,
  generateRoomId,
  isValidTtlMode,
  randomChars,
  clampMaxParticipants,
} from "@ghostchat/shared";

export interface RoomEnv {
  ROOMS: DurableObjectNamespace;
}

type Attachment = {
  displayId: string;
  publicKey: string;
  sessionToken: string;
  joinedAt: number;
  messageTimestamps: number[];
};

type RoomMeta = {
  kind: "room";
  roomId: string;
  publicCode: string;
  createdAt: number;
  maxParticipants: number;
};

type AliasMeta = {
  kind: "alias";
  targetRoomId: string;
};

const ALARM_IDLE = "idle";
const ALARM_MAX_AGE = "max_age";

function isLiveAttachment(a: Attachment | null | undefined): a is Attachment {
  return !!a && !a.sessionToken.endsWith("__replaced");
}

function isValidJoinPublicKey(pk: string): boolean {
  if (!pk || pk.length > 128) return false;
  return true;
}

function isValidMlsPayload(s: string): boolean {
  return (
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= LIMITS.maxMlsPayloadBytes
  );
}

/**
 * One Durable Object = one room (or a short-lived invite-code alias).
 * Relays ciphertext + MLS control frames only; never stores messages or keys.
 */
export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  private env: RoomEnv;
  private roomId = "";
  private publicCode = "";
  private createdAt = 0;
  private initialized = false;
  private isAlias = false;
  private aliasTarget = "";
  private maxParticipants: number = LIMITS.defaultMaxParticipants;

  constructor(state: DurableObjectState, env: RoomEnv) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const meta = await this.state.storage.get<RoomMeta | AliasMeta>("meta");
      if (!meta) return;
      if (meta.kind === "alias") {
        this.isAlias = true;
        this.aliasTarget = meta.targetRoomId;
        this.initialized = true;
        return;
      }
      this.roomId = meta.roomId;
      this.publicCode = meta.publicCode || meta.roomId;
      this.createdAt = meta.createdAt;
      this.maxParticipants = clampMaxParticipants(
        meta.maxParticipants ?? LIMITS.defaultMaxParticipants
      );
      this.initialized = true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/init" && request.method === "POST") {
      const body = (await request.json()) as {
        roomId: string;
        maxParticipants?: number;
      };
      if (!this.initialized) {
        this.roomId = body.roomId;
        this.publicCode = body.roomId;
        this.createdAt = Date.now();
        this.maxParticipants = clampMaxParticipants(body.maxParticipants);
        this.initialized = true;
        this.isAlias = false;
        await this.state.storage.put("meta", {
          kind: "room",
          roomId: this.roomId,
          publicCode: this.publicCode,
          createdAt: this.createdAt,
          maxParticipants: this.maxParticipants,
        } satisfies RoomMeta);
        await this.state.storage.setAlarm(Date.now() + LIMITS.maxAgeMs);
        await this.state.storage.put("alarmKind", ALARM_MAX_AGE);
      }
      return Response.json({
        ok: true,
        roomId: this.publicCode,
        internalId: this.roomId,
        maxParticipants: this.maxParticipants,
      });
    }

    if (path === "/init-alias" && request.method === "POST") {
      const body = (await request.json()) as { targetRoomId: string };
      if (this.initialized && !this.isAlias) {
        return Response.json({ ok: false, error: "occupied" }, { status: 409 });
      }
      this.isAlias = true;
      this.aliasTarget = body.targetRoomId;
      this.initialized = true;
      await this.state.storage.put("meta", {
        kind: "alias",
        targetRoomId: body.targetRoomId,
      } satisfies AliasMeta);
      return Response.json({ ok: true, targetRoomId: body.targetRoomId });
    }

    if (path === "/clear-alias" && request.method === "POST") {
      if (this.isAlias) {
        await this.state.storage.deleteAll();
        this.initialized = false;
        this.isAlias = false;
        this.aliasTarget = "";
      }
      return Response.json({ ok: true });
    }

    if (path === "/status" && request.method === "GET") {
      if (!this.initialized) {
        return Response.json({ status: "not_found" });
      }
      if (this.isAlias) {
        return Response.json({
          status: "alias",
          targetRoomId: this.aliasTarget,
        });
      }
      const count = this.uniqueSessions().size;
      return Response.json({
        status: "ok",
        roomId: this.publicCode,
        internalId: this.roomId,
        participantCount: count,
        maxParticipants: this.maxParticipants,
        full: count >= this.maxParticipants,
      });
    }

    if (path === "/ws") {
      if (!this.initialized) {
        return new Response(JSON.stringify({ error: "room_not_found" }), {
          status: 404,
        });
      }
      if (this.isAlias) {
        // Worker index should resolve aliases before upgrading; belt-and-suspenders
        return new Response(
          JSON.stringify({
            error: "room_not_found",
            aliasTo: this.aliasTarget,
          }),
          { status: 404 }
        );
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
        await this.handleJoin(
          ws,
          msg.displayId,
          msg.publicKey,
          msg.sessionToken
        );
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
      case "mls_key_package":
        if (!attachment) return;
        this.handleMlsKeyPackage(ws, attachment, msg.package);
        break;
      case "mls_welcome":
        if (!attachment) return;
        this.handleMlsWelcome(ws, attachment, msg.to, msg.welcome);
        break;
      case "mls_commit":
        if (!attachment) return;
        this.handleMlsCommit(ws, attachment, msg.commit);
        break;
      case "ping":
        this.send(ws, { v: PROTOCOL_VERSION, type: "pong" });
        break;
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ) {
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
    if (this.isAlias) return;
    const kind =
      (await this.state.storage.get<string>("alarmKind")) ?? ALARM_IDLE;

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
    if (!isValidJoinPublicKey(publicKey)) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "Invalid join payload",
      });
      ws.close(1008, "invalid_payload");
      return;
    }

    const token =
      sessionToken && sessionToken.length >= 8 && sessionToken.length <= 64
        ? sessionToken
        : randomChars(16);

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

    const sessions = this.uniqueSessions(ws);
    const isReturning = sessions.has(token);
    if (!isReturning && sessions.size >= this.maxParticipants) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "room_full",
        message: `Room full (max ${this.maxParticipants})`,
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

    const peers: PeerInfo[] = [];
    for (const s of this.joinedPeers(ws)) {
      const a = this.getAttachment(s);
      if (!a || a.sessionToken === token) continue;
      peers.push({ id: a.displayId, publicKey: a.publicKey });
    }

    const participantCount = this.uniqueSessions().size;
    const first = peers[0] ?? null;

    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: "joined",
      yourId: id,
      sessionToken: token,
      maxParticipants: this.maxParticipants,
      participantCount,
      peers,
      peerId: first?.id ?? null,
      peerPublicKey: first?.publicKey ?? null,
    });

    // Always tell joiner the current public invite code (may differ after rotates)
    this.send(ws, {
      v: PROTOCOL_VERSION,
      type: "room_code",
      publicCode: this.publicCode || this.roomId,
    });

    for (const peerWs of this.joinedPeers(ws)) {
      this.send(peerWs, {
        v: PROTOCOL_VERSION,
        type: "peer_joined",
        peerId: id,
        peerPublicKey: publicKey,
        participantCount,
      });
    }

    await this.touchActivity();
  }

  private handleMlsKeyPackage(
    ws: WebSocket,
    attachment: Attachment,
    pkg: string
  ) {
    if (!isValidMlsPayload(pkg)) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "MLS key package too large",
      });
      return;
    }
    this.broadcast(
      ws,
      {
        v: PROTOCOL_VERSION,
        type: "mls_key_package",
        from: attachment.displayId,
        package: pkg,
      },
      true
    );
    void this.touchActivity();
  }

  private handleMlsWelcome(
    ws: WebSocket,
    attachment: Attachment,
    to: string,
    welcome: string
  ) {
    if (!isValidMlsPayload(welcome) || !to) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "Invalid MLS welcome",
      });
      return;
    }
    for (const s of this.joinedPeers(ws)) {
      const a = this.getAttachment(s);
      if (a && a.displayId === to) {
        this.send(s, {
          v: PROTOCOL_VERSION,
          type: "mls_welcome",
          from: attachment.displayId,
          to,
          welcome,
        });
        void this.touchActivity();
        return;
      }
    }
  }

  private handleMlsCommit(
    ws: WebSocket,
    attachment: Attachment,
    commit: string
  ) {
    if (!isValidMlsPayload(commit)) {
      this.send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        code: "invalid_payload",
        message: "MLS commit too large",
      });
      return;
    }
    this.broadcast(
      ws,
      {
        v: PROTOCOL_VERSION,
        type: "mls_commit",
        from: attachment.displayId,
        commit,
      },
      true
    );
    void this.touchActivity();
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

    const peers = this.joinedPeers(ws);
    if (peers.length === 0) return;

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
    if (this.isAlias) return;
    const att = this.getAttachment(ws);
    if (!att) return;
    if (att.sessionToken.endsWith("__replaced")) return;

    for (const s of this.state.getWebSockets()) {
      if (s === ws) continue;
      const a = this.getAttachment(s);
      if (a && a.sessionToken === att.sessionToken) return;
    }

    const leftId = att.displayId;
    try {
      att.sessionToken = `${att.sessionToken}__gone`;
      this.setAttachment(ws, att);
    } catch {
      /* ignore */
    }

    const participantCount = this.uniqueSessions().size;

    this.broadcast(
      ws,
      {
        v: PROTOCOL_VERSION,
        type: "peer_left",
        peerId: leftId,
        participantCount,
      },
      true
    );

    if (participantCount === 0) {
      await this.state.storage.put("emptySince", Date.now());
      await this.state.storage.setAlarm(Date.now() + LIMITS.reconnectGraceMs);
      await this.state.storage.put("alarmKind", "empty");
    } else {
      // Someone left but room still live → rotate invite code
      await this.rotatePublicCode();
    }
  }

  /** Invalidate old invite code; publish a new one to remaining members. */
  private async rotatePublicCode() {
    if (!this.env?.ROOMS || this.isAlias || !this.roomId) return;

    let newCode: string | null = null;
    // Try several codes — collide with live rooms or busy alias slots
    for (let i = 0; i < 8; i++) {
      const candidate = generateRoomId();
      if (candidate === this.roomId || candidate === this.publicCode) continue;
      try {
        const aliasStub = this.env.ROOMS.get(
          this.env.ROOMS.idFromName(candidate)
        );
        const res = await aliasStub.fetch("https://do/init-alias", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetRoomId: this.roomId }),
        });
        if (res.ok) {
          newCode = candidate;
          break;
        }
      } catch {
        /* try next */
      }
    }
    if (!newCode) return;

    const oldPublic = this.publicCode;
    // Clear previous alias (if it was not the primary DO name)
    if (oldPublic && oldPublic !== this.roomId) {
      try {
        const oldAlias = this.env.ROOMS.get(
          this.env.ROOMS.idFromName(oldPublic)
        );
        await oldAlias.fetch("https://do/clear-alias", { method: "POST" });
      } catch {
        /* ignore */
      }
    }

    this.publicCode = newCode;
    await this.state.storage.put("meta", {
      kind: "room",
      roomId: this.roomId,
      publicCode: this.publicCode,
      createdAt: this.createdAt,
      maxParticipants: this.maxParticipants,
    } satisfies RoomMeta);

    this.broadcast(
      null,
      {
        v: PROTOCOL_VERSION,
        type: "room_code",
        publicCode: this.publicCode,
      },
      false
    );
  }

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
    // Drop current public alias if any
    if (
      this.env?.ROOMS &&
      this.publicCode &&
      this.publicCode !== this.roomId
    ) {
      try {
        const oldAlias = this.env.ROOMS.get(
          this.env.ROOMS.idFromName(this.publicCode)
        );
        await oldAlias.fetch("https://do/clear-alias", { method: "POST" });
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
      /* ignore */
    }
  }

  private broadcast(
    except: WebSocket | null,
    msg: ServerMessage,
    skipSender: boolean
  ) {
    for (const s of this.state.getWebSockets()) {
      if (skipSender && except && s === except) continue;
      if (!isLiveAttachment(this.getAttachment(s))) continue;
      this.send(s, msg);
    }
  }

  private getAttachment(ws: WebSocket): Attachment | null {
    try {
      return (ws.deserializeAttachment() as Attachment | null) ?? null;
    } catch {
      return null;
    }
  }

  private setAttachment(ws: WebSocket, att: Attachment) {
    try {
      ws.serializeAttachment(att);
    } catch {
      /* ignore */
    }
  }
}
