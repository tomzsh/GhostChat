#!/usr/bin/env node
/**
 * GhostChat CLI — `ghost create` | `ghost join`
 * MLS (RFC 9420) group E2EE — same protocol as web.
 */
import WebSocket from "ws";
import * as readline from "node:readline";
import {
  createMlsSession,
  bootstrapGroup,
  exportKeyPackage,
  addMember,
  acceptWelcome,
  processCommitIfNeeded,
  removeMember,
  encryptApp,
  decryptApp,
  epochSafetyNumber,
  hasMlsGroup,
  findLeafIndex,
  MLS_NONCE_MARKER,
  type MlsSession,
} from "@ghostchat/crypto";
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
  type PeerInfo,
} from "@ghostchat/protocol";
import {
  generateDisplayId,
  generateMessageId,
  isValidRoomId,
  isValidTtlMode,
  isOnLeaveTtl,
  normalizeRoomId,
  parseTtlMs,
  randomChars,
  clampMaxParticipants,
  LIMITS,
  type TtlMode,
} from "@ghostchat/shared";
import * as ui from "./ui.js";

const API_BASE = process.env.GHOST_API_URL ?? "http://127.0.0.1:8787";
const WS_BASE = process.env.GHOST_WS_URL ?? API_BASE.replace(/^http/, "ws");
const WEB_ORIGIN = process.env.GHOST_WEB_URL ?? "http://127.0.0.1:3000";

const KP_RETRY_MS = [300, 1200, 2800, 5500, 9000];

function usage(): never {
  process.stdout.write(ui.banner());
  console.log(
    ui.box("USAGE", [
      ui.c.white("ghost create") +
        ui.c.dim(" [--ttl 10s|60s|on_read|on_leave] [--max N]"),
      ui.c.white("ghost join") + ui.c.dim(" <ROOM_ID>"),
      "",
      ui.c.dim(
        `max members  ${LIMITS.minMaxParticipants}–${LIMITS.maxParticipantsCap} (default ${LIMITS.defaultMaxParticipants})`
      ),
      ui.c.dim(`env  GHOST_API_URL  GHOST_WS_URL  GHOST_WEB_URL`),
      ui.c.dim("e2ee  MLS (RFC 9420) via ts-mls"),
    ])
  );
  console.log("");
  process.exit(1);
}

async function createRoom(maxParticipants: number): Promise<{
  roomId: string;
  maxParticipants: number;
}> {
  const res = await fetch(`${API_BASE}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxParticipants }),
  });
  if (!res.ok) throw new Error(`Create failed: ${res.status}`);
  return res.json() as Promise<{ roomId: string; maxParticipants: number }>;
}

async function checkRoom(roomId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/rooms/${roomId}`);
  if (res.status === 404) throw new Error("Room not found");
  if (res.status === 429) throw new Error("Rate limited — try again shortly");
  const body = (await res.json()) as {
    status: string;
    full?: boolean;
    maxParticipants?: number;
  };
  if (body.status === "not_found") throw new Error("Room not found");
  if (body.full)
    throw new Error(
      `Room is full${body.maxParticipants ? ` (max ${body.maxParticipants})` : ""}`
    );
}

/** Elect committer among members already in MLS (exclude pending joiners). */
function isCommitter(
  myId: string,
  memberIds: string[],
  hasGroup: boolean,
  pendingJoiners: Iterable<string> = []
) {
  if (!hasGroup || !myId) return false;
  const pending = new Set(pendingJoiners);
  const candidates = [
    myId,
    ...memberIds.filter((id) => id !== myId && !pending.has(id)),
  ].sort();
  return candidates[0] === myId;
}

async function runSession(roomId: string, defaultTtl: TtlMode) {
  const displayId = generateDisplayId();
  const sessionToken = randomChars(24);
  let mls: MlsSession | null = null;
  let safetyNumber: string | null = null;
  let myId = displayId;
  const members = new Map<string, string>();
  const pendingKp = new Map<string, string>();
  let maxParticipants: number = 2;
  let participantCount = 1;
  let publicCode = roomId;
  let ttlMode: TtlMode = defaultTtl;
  const burnTimers = new Map<string, NodeJS.Timeout>();
  /** messageId → sender for `on_leave` burn mode */
  const onLeaveMsgs = new Map<string, string>();
  let cleaned = false;
  const kpRetryTimers: NodeJS.Timeout[] = [];
  const adding = new Set<string>();

  const ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
    terminal: true,
  });

  function canSend() {
    return hasMlsGroup(mls) && members.size > 0;
  }

  function setSafety() {
    safetyNumber = mls ? epochSafetyNumber(mls) : null;
  }

  function paintStatus() {
    const peerList =
      members.size === 0
        ? ui.c.gray("none")
        : [...members.keys()].map((id) => ui.c.cyan(id)).join(ui.c.dim(", "));
    ui.printLine(
      ui.c.dim("  room ") +
        ui.c.bold(ui.c.brightGreen(publicCode)) +
        (publicCode !== roomId
          ? ui.c.dim(` (was ${roomId})`)
          : "") +
        ui.c.dim("  you ") +
        ui.c.cyan(myId) +
        ui.c.dim(`  ${participantCount}/${maxParticipants}`) +
        ui.c.dim("  peers ") +
        peerList +
        ui.c.dim("  burn ") +
        ui.c.yellow(ttlMode) +
        ui.c.dim("  mls")
    );
  }

  function setPrompt() {
    rl.setPrompt(ui.promptStr({ ttl: ttlMode, ready: canSend() }));
    rl.prompt(true);
  }

  function sendJson(obj: unknown) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function broadcastKp() {
    if (!mls || mls.state) return;
    sendJson({
      v: PROTOCOL_VERSION,
      type: "mls_key_package",
      package: exportKeyPackage(mls),
    });
  }

  function scheduleKpRetries() {
    for (const t of kpRetryTimers) clearTimeout(t);
    kpRetryTimers.length = 0;
    for (const delay of KP_RETRY_MS) {
      kpRetryTimers.push(
        setTimeout(() => {
          if (!hasMlsGroup(mls)) broadcastKp();
        }, delay)
      );
    }
  }

  let mlsOp: Promise<void> = Promise.resolve();
  function enqueueMls<T>(fn: () => Promise<T>): Promise<T> {
    const run = mlsOp.then(fn, fn);
    mlsOp = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function tryAddPending() {
    return enqueueMls(async () => {
      if (!mls?.state) return;
      if (!isCommitter(myId, [...members.keys()], true, pendingKp.keys())) {
        return;
      }
      for (const [peerId, pkg] of [...pendingKp.entries()]) {
        if (!mls?.state) return;
        if (adding.has(peerId) || peerId === myId) continue;
        if (findLeafIndex(mls, peerId) !== null) {
          pendingKp.delete(peerId);
          continue;
        }
        adding.add(peerId);
        try {
          const result = await addMember(mls, pkg);
          mls = result.session;
          setSafety();
          pendingKp.delete(peerId);
          sendJson({
            v: PROTOCOL_VERSION,
            type: "mls_welcome",
            to: peerId,
            welcome: result.welcomeB64,
          });
          sendJson({
            v: PROTOCOL_VERSION,
            type: "mls_commit",
            commit: result.commitB64,
          });
          ui.ok(`MLS added · ${peerId}`);
          if (safetyNumber) process.stdout.write(ui.safetyCard(safetyNumber));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "add member failed";
          if (/already|duplicate|exist/i.test(msg)) {
            pendingKp.delete(peerId);
          } else {
            ui.err(msg);
          }
        } finally {
          adding.delete(peerId);
        }
      }
    });
  }

  function burn(id: string) {
    const t = burnTimers.get(id);
    if (t) clearTimeout(t);
    burnTimers.delete(id);
    onLeaveMsgs.delete(id);
    ui.burned(id);
  }

  /** Burn `on_leave` messages from a departing sender. */
  function burnOnLeaveFrom(senderId: string, reason: string) {
    const ids = [...onLeaveMsgs.entries()]
      .filter(([, from]) => from === senderId)
      .map(([id]) => id);
    for (const id of ids) burn(id);
    if (ids.length > 0) {
      ui.sys(`on_leave burned · ${reason} (${ids.length})`);
    }
  }

  function scheduleBurn(
    messageId: string,
    mode: TtlMode,
    mine: boolean,
    fromId: string
  ) {
    if (isOnLeaveTtl(mode)) {
      onLeaveMsgs.set(messageId, fromId);
      return;
    }
    if (mode === "on_read") {
      if (!mine) {
        const t = setTimeout(() => {
          burn(messageId);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                v: PROTOCOL_VERSION,
                type: "burn",
                messageId,
              })
            );
          }
          setPrompt();
        }, 2500);
        burnTimers.set(messageId, t);
      }
      return;
    }
    const ms = parseTtlMs(mode);
    if (ms === null) return;
    const t = setTimeout(() => {
      burn(messageId);
      if (!mine && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            type: "burn",
            messageId,
          })
        );
      }
      setPrompt();
    }, ms);
    burnTimers.set(messageId, t);
  }

  async function handleServer(msg: ServerMessage) {
    switch (msg.type) {
      case "joined": {
        myId = msg.yourId;
        maxParticipants = msg.maxParticipants ?? 2;
        participantCount = msg.participantCount ?? 1;
        ui.ok(ui.c.dim("connected as ") + ui.c.cyan(myId));
        members.clear();
        const peers: PeerInfo[] =
          msg.peers ??
          (msg.peerId
            ? [{ id: msg.peerId, publicKey: msg.peerPublicKey ?? "mls" }]
            : []);
        for (const p of peers) members.set(p.id, p.publicKey || "mls");

        mls = await createMlsSession(myId, roomId);
        if (members.size === 0) {
          mls = await bootstrapGroup(mls);
          setSafety();
          ui.warn("waiting for peers — share the room code (MLS group ready)");
        } else {
          ui.sys(`peers online: ${[...members.keys()].join(", ")}`);
          ui.warn("waiting for MLS welcome…");
          broadcastKp();
          scheduleKpRetries();
        }
        if (safetyNumber) process.stdout.write(ui.safetyCard(safetyNumber));
        paintStatus();
        setPrompt();
        break;
      }
      case "peer_joined":
        members.set(msg.peerId, msg.peerPublicKey || "mls");
        participantCount = msg.participantCount ?? members.size + 1;
        ui.ok(ui.c.white("peer joined · ") + ui.c.cyan(msg.peerId));
        paintStatus();
        setPrompt();
        break;
      case "peer_left": {
        members.delete(msg.peerId);
        pendingKp.delete(msg.peerId);
        participantCount = msg.participantCount ?? members.size + 1;
        ui.warn(`peer left · ${msg.peerId}`);
        burnOnLeaveFrom(msg.peerId, `peer left · ${msg.peerId}`);
        // Invite rotation (also arrives as room_code)
        const rotated = String(msg.publicCode ?? "")
          .trim()
          .toUpperCase();
        if (rotated && rotated !== publicCode) {
          publicCode = rotated;
          ui.warn(`invite code rotated → ${ui.c.brightGreen(publicCode)}`);
        }
        if (mls?.state) {
          await enqueueMls(async () => {
            if (
              !mls?.state ||
              !isCommitter(
                myId,
                [...members.keys()],
                true,
                pendingKp.keys()
              )
            ) {
              return;
            }
            try {
              const rem = await removeMember(mls, msg.peerId);
              if (rem) {
                mls = rem.session;
                setSafety();
                sendJson({
                  v: PROTOCOL_VERSION,
                  type: "mls_commit",
                  commit: rem.commitB64,
                });
                ui.sys("MLS remove commit sent");
              }
            } catch {
              /* ignore */
            }
          });
        }
        paintStatus();
        setPrompt();
        break;
      }
      case "mls_key_package":
        if (!msg.from || msg.from === myId) break;
        pendingKp.set(msg.from, msg.package);
        await tryAddPending();
        setPrompt();
        break;
      case "mls_welcome":
        if (msg.to !== myId) break;
        if (hasMlsGroup(mls)) break;
        try {
          await enqueueMls(async () => {
            if (hasMlsGroup(mls)) return;
            if (!mls) mls = await createMlsSession(myId, roomId);
            mls = await acceptWelcome(mls, msg.welcome);
            setSafety();
            for (const t of kpRetryTimers) clearTimeout(t);
            ui.ok("MLS welcome · channel open");
            if (safetyNumber) process.stdout.write(ui.safetyCard(safetyNumber));
          });
          await tryAddPending();
        } catch {
          ui.err("failed to accept MLS welcome");
        }
        paintStatus();
        setPrompt();
        break;
      case "mls_commit":
        if (msg.from === myId) break;
        // No state yet → wait for Welcome; do not error on the Add commit
        if (!mls?.state) break;
        try {
          await enqueueMls(async () => {
            if (!mls?.state) return;
            const { session: next, applied } = await processCommitIfNeeded(
              mls,
              msg.commit
            );
            mls = next;
            if (applied) {
              setSafety();
              ui.sys("MLS epoch advanced");
            }
            // stale after Welcome: silent
          });
          await tryAddPending();
        } catch {
          ui.err("MLS commit process failed");
        }
        setPrompt();
        break;
      case "message":
        if (!mls?.state) break;
        try {
          await enqueueMls(async () => {
            if (!mls?.state) return;
            const result = await decryptApp(mls, msg.ciphertext);
            mls = result.session;
            if (result.text) {
              ui.msgPeer(msg.from, result.text, msg.ttlMode);
              scheduleBurn(msg.messageId, msg.ttlMode, false, msg.from);
            }
          });
        } catch {
          ui.err("decrypt failed");
        }
        setPrompt();
        break;
      case "typing":
        if (msg.state) ui.typingLine(msg.from);
        else setPrompt();
        break;
      case "burn":
        burn(msg.messageId);
        setPrompt();
        break;
      case "error":
        ui.err(`${msg.code}${msg.message ? ": " + msg.message : ""}`);
        if (msg.code === "room_full" || msg.code === "room_not_found") {
          cleanup(1);
        }
        setPrompt();
        break;
      case "room_closed":
        for (const id of [...onLeaveMsgs.keys()]) burn(id);
        ui.sys(`room closed (${msg.reason})`);
        cleanup(0);
        break;
      case "room_code": {
        const code = String(msg.publicCode ?? "")
          .trim()
          .toUpperCase();
        if (code && code !== publicCode) {
          publicCode = code;
          ui.warn(`invite code rotated → ${ui.c.brightGreen(publicCode)}`);
          ui.sys("old code no longer works for new joiners");
          paintStatus();
        }
        setPrompt();
        break;
      }
      case "pong":
        break;
    }
  }

  function cleanup(code: number) {
    if (cleaned) return;
    cleaned = true;
    burnTimers.forEach((t) => clearTimeout(t));
    for (const t of kpRetryTimers) clearTimeout(t);
    try {
      ws.close();
    } catch {
      /* */
    }
    try {
      rl.close();
    } catch {
      /* */
    }
    ui.goodbye();
    process.exit(code);
  }

  ws.on("open", () => {
    ui.sys("handshake…");
    ws.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "join",
        displayId,
        publicKey: "mls",
        sessionToken,
      })
    );
  });

  ws.on("message", (data) => {
    void (async () => {
      try {
        const msg = parseServerMessage(JSON.parse(String(data)));
        if (msg) await handleServer(msg);
      } catch {
        /* */
      }
    })();
  });

  ws.on("error", (e) => {
    ui.err(`websocket: ${e.message}`);
    ui.sys(`is the worker up?  ${API_BASE}`);
    cleanup(1);
  });

  ws.on("close", () => {
    if (!cleaned) {
      ui.sys("disconnected");
      cleanup(0);
    }
  });

  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "ping" }));
    }
  }, 25000);

  rl.on("line", (line) => {
    void (async () => {
      const input = line.trim();
      if (!input) {
        setPrompt();
        return;
      }

      if (input === "/quit" || input === "/exit" || input === "/q") {
        clearInterval(ping);
        cleanup(0);
        return;
      }

      if (input === "/who" || input === "/status") {
        paintStatus();
        if (safetyNumber) process.stdout.write(ui.safetyCard(safetyNumber));
        setPrompt();
        return;
      }

      if (input === "/safety" || input === "/fp") {
        if (safetyNumber) process.stdout.write(ui.safetyCard(safetyNumber));
        else ui.warn("no safety number yet");
        setPrompt();
        return;
      }

      if (input === "/help" || input === "/?") {
        ui.printLine(ui.helpInline());
        setPrompt();
        return;
      }

      if (input.startsWith("/ttl")) {
        const mode = input.slice(4).trim();
        if (!mode) ui.sys(`current burn: ${ttlMode}`);
        else if (isValidTtlMode(mode)) {
          ttlMode = mode;
          ui.ok(`burn after → ${ui.c.yellow(ttlMode)}`);
          paintStatus();
        } else ui.err("usage: /ttl on_read|on_leave|10s|60s");
        setPrompt();
        return;
      }

      if (input.startsWith("/")) {
        ui.warn("unknown command — try /help");
        setPrompt();
        return;
      }

      if (!canSend() || !mls?.state) {
        ui.warn(
          members.size === 0
            ? "waiting for peers — message not sent"
            : "MLS not ready — message not sent"
        );
        setPrompt();
        return;
      }

      try {
        await enqueueMls(async () => {
          if (!mls?.state) throw new Error("MLS not ready");
          const messageId = generateMessageId();
          const enc = await encryptApp(mls, input);
          mls = enc.session;
          ws.send(
            JSON.stringify({
              v: PROTOCOL_VERSION,
              type: "message",
              ciphertext: enc.ciphertextB64,
              nonce: MLS_NONCE_MARKER,
              ttlMode,
              messageId,
            })
          );
          ui.msgYou(input, ttlMode);
          scheduleBurn(messageId, ttlMode, true, myId);
        });
      } catch (e) {
        ui.err(e instanceof Error ? e.message : "send failed");
      }
      setPrompt();
    })();
  });

  rl.on("close", () => {
    clearInterval(ping);
    cleanup(0);
  });

  process.stdout.write(ui.sessionHeader(roomId));
  paintStatus();
  ui.sys("opening MLS encrypted relay…");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const cmd = args[0];

  if (cmd === "create") {
    process.stdout.write(ui.banner());
    let ttl: TtlMode = "60s";
    let max: number = LIMITS.defaultMaxParticipants;
    const ttlIdx = args.indexOf("--ttl");
    if (ttlIdx >= 0 && args[ttlIdx + 1]) {
      const t = args[ttlIdx + 1]!;
      if (!isValidTtlMode(t)) {
        ui.err("invalid --ttl (use 10s|60s|on_read|on_leave)");
        process.exit(1);
      }
      ttl = t;
    }
    const maxIdx = args.indexOf("--max");
    if (maxIdx >= 0 && args[maxIdx + 1]) {
      max = clampMaxParticipants(args[maxIdx + 1]);
    }
    ui.sys(`creating room (max ${max})…`);
    const { roomId, maxParticipants } = await createRoom(max);
    process.stdout.write(
      ui.roomCreatedCard(roomId, `${WEB_ORIGIN}/r/${roomId}`)
    );
    ui.sys(`max members: ${maxParticipants}`);
    await runSession(roomId, ttl);
    return;
  }

  if (cmd === "join") {
    process.stdout.write(ui.banner());
    const raw = args[1];
    if (!raw) usage();
    const roomId = normalizeRoomId(raw);
    if (!isValidRoomId(roomId)) {
      ui.err("invalid room id (6 chars, no 0/O/1/I)");
      process.exit(1);
    }
    ui.sys(`checking room ${ui.c.brightGreen(roomId)}…`);
    await checkRoom(roomId);
    ui.ok("room found — joining");
    await runSession(roomId, "60s");
    return;
  }

  usage();
}

main().catch((e) => {
  ui.err(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
