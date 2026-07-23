#!/usr/bin/env node
/**
 * GhostChat CLI — `ghost create` | `ghost join <ROOM_ID>`
 * Supports 1:1 and small groups (shared room key).
 */
import WebSocket from "ws";
import * as readline from "node:readline";
import {
  decryptFromWire,
  encryptToWire,
  generateKeyPair,
  generateRoomKey,
  wrapRoomKeyForPeer,
  unwrapRoomKeyFromPeer,
  publicKeyToBase64,
  publicKeyFromBase64,
  safetyNumberFromKey,
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

function usage(): never {
  process.stdout.write(ui.banner());
  console.log(
    ui.box("USAGE", [
      ui.c.white("ghost create") +
        ui.c.dim(" [--ttl 10s|60s|on_read] [--max N]"),
      ui.c.white("ghost join") + ui.c.dim(" <ROOM_ID>"),
      "",
      ui.c.dim(`max members  ${LIMITS.minMaxParticipants}–${LIMITS.maxParticipantsCap} (default ${LIMITS.defaultMaxParticipants})`),
      ui.c.dim(`env  GHOST_API_URL  GHOST_WS_URL  GHOST_WEB_URL`),
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

async function runSession(roomId: string, defaultTtl: TtlMode) {
  const keyPair = generateKeyPair();
  const displayId = generateDisplayId();
  const sessionToken = randomChars(24);
  let roomKey: Uint8Array | null = null;
  let safetyNumber: string | null = null;
  let myId = displayId;
  const members = new Map<string, string>(); // id -> publicKey
  let maxParticipants: number = 2;
  let participantCount = 1;
  let ttlMode: TtlMode = defaultTtl;
  const burnTimers = new Map<string, NodeJS.Timeout>();
  let cleaned = false;

  const ws = new WebSocket(`${WS_BASE}/ws/${roomId}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
    terminal: true,
  });

  function hasPeers() {
    return members.size > 0;
  }

  function canSend() {
    return !!roomKey && hasPeers();
  }

  function paintStatus() {
    const peerList =
      members.size === 0
        ? ui.c.gray("none")
        : [...members.keys()].map((id) => ui.c.cyan(id)).join(ui.c.dim(", "));
    ui.printLine(
      ui.c.dim("  room ") +
        ui.c.bold(ui.c.brightGreen(roomId)) +
        ui.c.dim("  you ") +
        ui.c.cyan(myId) +
        ui.c.dim(`  ${participantCount}/${maxParticipants}`) +
        ui.c.dim("  peers ") +
        peerList +
        ui.c.dim("  burn ") +
        ui.c.yellow(ttlMode)
    );
  }

  function setPrompt() {
    rl.setPrompt(
      ui.promptStr({ ttl: ttlMode, ready: canSend() })
    );
    rl.prompt(true);
  }

  function setRoomKey(key: Uint8Array) {
    roomKey = key;
    safetyNumber = safetyNumberFromKey(key);
    clearKeyRequestRetries();
  }

  const keyShareRetryTimers = new Map<string, NodeJS.Timeout[]>();
  let keyRequestTimers: NodeJS.Timeout[] = [];
  const KEY_SHARE_RETRY_MS = [0, 600, 1800, 4000];
  const KEY_REQUEST_RETRY_MS = [400, 1200, 2800, 5500, 9000];

  function clearKeyShareRetries(peerId?: string) {
    if (peerId) {
      const list = keyShareRetryTimers.get(peerId);
      if (list) {
        list.forEach(clearTimeout);
        keyShareRetryTimers.delete(peerId);
      }
      return;
    }
    for (const list of keyShareRetryTimers.values()) list.forEach(clearTimeout);
    keyShareRetryTimers.clear();
  }

  function clearKeyRequestRetries() {
    keyRequestTimers.forEach(clearTimeout);
    keyRequestTimers = [];
  }

  function shareKeyWith(id: string, publicKey: string) {
    if (!roomKey || ws.readyState !== WebSocket.OPEN) return;
    try {
      const wire = wrapRoomKeyForPeer(
        keyPair.privateKey,
        publicKeyFromBase64(publicKey),
        roomKey,
        roomId
      );
      ws.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "key_share",
          to: id,
          ciphertext: wire.ciphertext,
          nonce: wire.nonce,
        })
      );
    } catch {
      /* ignore */
    }
  }

  /** Share room key + retries (peer may miss the first packet). */
  function shareKeyWithRetry(id: string, publicKey: string) {
    clearKeyShareRetries(id);
    const timers: NodeJS.Timeout[] = [];
    for (const delay of KEY_SHARE_RETRY_MS) {
      const t = setTimeout(() => {
        if (!roomKey || !members.has(id)) return;
        shareKeyWith(id, publicKey);
      }, delay);
      timers.push(t);
    }
    keyShareRetryTimers.set(id, timers);
  }

  function requestRoomKey() {
    if (roomKey || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "key_request",
      })
    );
  }

  function scheduleKeyRequests() {
    clearKeyRequestRetries();
    if (roomKey) return;
    for (const delay of KEY_REQUEST_RETRY_MS) {
      const t = setTimeout(() => {
        if (!roomKey) requestRoomKey();
      }, delay);
      keyRequestTimers.push(t);
    }
  }

  function burn(id: string) {
    const t = burnTimers.get(id);
    if (t) clearTimeout(t);
    burnTimers.delete(id);
    ui.burned(id);
  }

  function scheduleBurn(messageId: string, mode: TtlMode, mine: boolean) {
    const ms = parseTtlMs(mode);
    if (ms === null) {
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

  function handleServer(msg: ServerMessage) {
    switch (msg.type) {
      case "joined":
        myId = msg.yourId;
        maxParticipants = msg.maxParticipants ?? 2;
        participantCount = msg.participantCount ?? 1;
        ui.ok(ui.c.dim("connected as ") + ui.c.cyan(myId));
        members.clear();
        const peers: PeerInfo[] =
          msg.peers ??
          (msg.peerId && msg.peerPublicKey
            ? [{ id: msg.peerId, publicKey: msg.peerPublicKey }]
            : []);
        for (const p of peers) members.set(p.id, p.publicKey);
        if (members.size === 0) {
          setRoomKey(generateRoomKey());
          ui.warn("waiting for peers — share the room code");
        } else {
          ui.sys(`peers online: ${[...members.keys()].join(", ")}`);
          ui.warn("waiting for room key…");
          scheduleKeyRequests();
        }
        if (safetyNumber) process.stdout.write(ui.safetyCard(safetyNumber));
        paintStatus();
        setPrompt();
        break;
      case "peer_joined":
        members.set(msg.peerId, msg.peerPublicKey);
        participantCount = msg.participantCount ?? members.size + 1;
        ui.ok(ui.c.white("peer joined · ") + ui.c.cyan(msg.peerId));
        if (roomKey) {
          shareKeyWithRetry(msg.peerId, msg.peerPublicKey);
        } else {
          scheduleKeyRequests();
        }
        paintStatus();
        setPrompt();
        break;
      case "peer_left":
        members.delete(msg.peerId);
        clearKeyShareRetries(msg.peerId);
        participantCount = msg.participantCount ?? members.size + 1;
        ui.warn(`peer left · ${msg.peerId}`);
        paintStatus();
        setPrompt();
        break;
      case "key_share":
        if (msg.to !== myId || roomKey) break;
        try {
          const pk = members.get(msg.from);
          if (!pk) break;
          const key = unwrapRoomKeyFromPeer(
            keyPair.privateKey,
            publicKeyFromBase64(pk),
            msg.ciphertext,
            msg.nonce,
            roomId
          );
          setRoomKey(key);
          ui.ok("room key received · channel open");
          if (safetyNumber) process.stdout.write(ui.safetyCard(safetyNumber));
          // One-shot mesh; peers can key_request if still missing
          for (const [id, publicKey] of members) {
            if (id === msg.from) continue;
            shareKeyWith(id, publicKey);
          }
        } catch {
          ui.err("failed to unwrap room key");
        }
        paintStatus();
        setPrompt();
        break;
      case "key_request": {
        // Requester retries key_request — reply once to avoid share storms
        if (!roomKey || !msg.from) break;
        const pk = members.get(msg.from);
        if (!pk) break;
        shareKeyWith(msg.from, pk);
        break;
      }
      case "message":
        if (!roomKey) break;
        try {
          const text = decryptFromWire(
            roomKey,
            msg.ciphertext,
            msg.nonce
          );
          ui.msgPeer(msg.from, text, msg.ttlMode);
          scheduleBurn(msg.messageId, msg.ttlMode, false);
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
        ui.err(
          `${msg.code}${msg.message ? ": " + msg.message : ""}`
        );
        if (msg.code === "room_full" || msg.code === "room_not_found") {
          cleanup(1);
        }
        setPrompt();
        break;
      case "room_closed":
        ui.sys(`room closed (${msg.reason})`);
        cleanup(0);
        break;
      case "pong":
        break;
    }
  }

  function cleanup(code: number) {
    if (cleaned) return;
    cleaned = true;
    burnTimers.forEach((t) => clearTimeout(t));
    clearKeyShareRetries();
    clearKeyRequestRetries();
    keyPair.privateKey.fill(0);
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
        publicKey: publicKeyToBase64(keyPair.publicKey),
        sessionToken,
      })
    );
  });

  ws.on("message", (data) => {
    try {
      const msg = parseServerMessage(JSON.parse(String(data)));
      if (msg) handleServer(msg);
    } catch {
      /* */
    }
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
      } else ui.err("usage: /ttl on_read|10s|60s");
      setPrompt();
      return;
    }

    if (input.startsWith("/")) {
      ui.warn("unknown command — try /help");
      setPrompt();
      return;
    }

    if (!canSend() || !roomKey) {
      ui.warn(
        members.size === 0
          ? "waiting for peers — message not sent"
          : "encryption not ready — message not sent"
      );
      setPrompt();
      return;
    }

    try {
      const messageId = generateMessageId();
      const wire = encryptToWire(roomKey, input);
      ws.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "message",
          ciphertext: wire.ciphertext,
          nonce: wire.nonce,
          ttlMode,
          messageId,
        })
      );
      ui.msgYou(input, ttlMode);
      scheduleBurn(messageId, ttlMode, true);
    } catch (e) {
      ui.err(e instanceof Error ? e.message : "send failed");
    }
    setPrompt();
  });

  rl.on("close", () => {
    clearInterval(ping);
    cleanup(0);
  });

  process.stdout.write(ui.sessionHeader(roomId));
  paintStatus();
  ui.sys("opening encrypted relay…");
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
        ui.err("invalid --ttl (use 10s|60s|on_read)");
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
      ui.roomCreatedCard(
        roomId,
        `${WEB_ORIGIN}/r/${roomId}`
      )
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
