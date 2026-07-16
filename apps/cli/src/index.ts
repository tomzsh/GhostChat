#!/usr/bin/env node
/**
 * GhostChat CLI — `ghost create` | `ghost join <ROOM_ID>`
 */
import WebSocket from "ws";
import * as readline from "node:readline";
import {
  decryptFromWire,
  encryptToWire,
  generateKeyPair,
  deriveSharedKey,
  publicKeyToBase64,
  publicKeyFromBase64,
  safetyNumberFromKey,
} from "@ghostchat/crypto";
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
} from "@ghostchat/protocol";
import {
  generateDisplayId,
  generateMessageId,
  isValidRoomId,
  isValidTtlMode,
  normalizeRoomId,
  parseTtlMs,
  randomChars,
  type TtlMode,
} from "@ghostchat/shared";
import * as ui from "./ui.js";

const API_BASE = process.env.GHOST_API_URL ?? "http://127.0.0.1:8787";
const WS_BASE = process.env.GHOST_WS_URL ?? API_BASE.replace(/^http/, "ws");
const WEB_ORIGIN = process.env.GHOST_WEB_URL ?? "http://127.0.0.1:3000";

function usage(): never {
  process.stdout.write(ui.banner());
  console.log(ui.box("USAGE", [
    ui.c.white("ghost create") + ui.c.dim(" [--ttl 10s|60s|on_read]"),
    ui.c.white("ghost join") + ui.c.dim(" <ROOM_ID>"),
    "",
    ui.c.dim("env  GHOST_API_URL  GHOST_WS_URL  GHOST_WEB_URL"),
    ui.c.dim(`def  ${API_BASE}`),
  ]));
  console.log("");
  process.exit(1);
}

async function createRoom(): Promise<{ roomId: string }> {
  const res = await fetch(`${API_BASE}/api/rooms`, { method: "POST" });
  if (!res.ok) throw new Error(`Create failed: ${res.status}`);
  return res.json() as Promise<{ roomId: string }>;
}

async function checkRoom(roomId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/rooms/${roomId}`);
  if (res.status === 404) throw new Error("Room not found");
  if (res.status === 429) throw new Error("Rate limited — try again shortly");
  const body = (await res.json()) as { status: string; full?: boolean };
  if (body.status === "not_found") throw new Error("Room not found");
  if (body.full) throw new Error("Room is full (max 2)");
}

async function runSession(roomId: string, defaultTtl: TtlMode) {
  const keyPair = generateKeyPair();
  const displayId = generateDisplayId();
  const sessionToken = randomChars(24);
  let sharedKey: Uint8Array | null = null;
  let safetyNumber: string | null = null;
  let myId = displayId;
  let peerId: string | null = null;
  let peerOnline = false;
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

  function paintStatus() {
    ui.printLine(
      ui.statusBar({
        roomId,
        myId,
        peerId,
        peerOnline,
        ttl: ttlMode,
      })
    );
  }

  function setPrompt() {
    const ready = peerOnline && !!sharedKey;
    rl.setPrompt(ui.promptStr({ ttl: ttlMode, ready }));
    rl.prompt(true);
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

  function onChannelReady(peer: string, peerPk: string) {
    sharedKey = deriveSharedKey(
      keyPair.privateKey,
      publicKeyFromBase64(peerPk),
      roomId
    );
    safetyNumber = safetyNumberFromKey(sharedKey);
    peerId = peer;
    peerOnline = true;
    ui.ok(
      ui.c.white("channel open · peer ") + ui.c.cyan(peer)
    );
    if (safetyNumber) {
      process.stdout.write(ui.safetyCard(safetyNumber));
    }
    paintStatus();
  }

  function handleServer(msg: ServerMessage) {
    switch (msg.type) {
      case "joined":
        myId = msg.yourId;
        ui.ok(ui.c.dim("connected as ") + ui.c.cyan(myId));
        if (msg.peerId && msg.peerPublicKey) {
          onChannelReady(msg.peerId, msg.peerPublicKey);
        } else {
          ui.warn("waiting for peer — share the room code");
          paintStatus();
        }
        setPrompt();
        break;
      case "peer_joined":
        onChannelReady(msg.peerId, msg.peerPublicKey);
        setPrompt();
        break;
      case "peer_left":
        peerOnline = false;
        peerId = null;
        sharedKey = null;
        safetyNumber = null;
        ui.warn("peer left — waiting for rejoin…");
        paintStatus();
        setPrompt();
        break;
      case "message":
        if (!sharedKey) break;
        try {
          const text = decryptFromWire(
            sharedKey,
            msg.ciphertext,
            msg.nonce
          );
          ui.msgPeer(msg.from, text, msg.ttlMode);
          scheduleBurn(msg.messageId, msg.ttlMode, false);
        } catch {
          ui.err("decrypt failed (key mismatch?)");
        }
        setPrompt();
        break;
      case "typing":
        if (msg.state) {
          ui.typingLine(msg.from);
        } else {
          setPrompt();
        }
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
      if (safetyNumber) {
        process.stdout.write(ui.safetyCard(safetyNumber));
      }
      setPrompt();
      return;
    }

    if (input === "/safety" || input === "/fp") {
      if (safetyNumber) {
        process.stdout.write(ui.safetyCard(safetyNumber));
      } else {
        ui.warn("no safety number yet — wait for peer");
      }
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
      if (!mode) {
        ui.sys(`current burn: ${ttlMode}`);
      } else if (isValidTtlMode(mode)) {
        ttlMode = mode;
        ui.ok(`burn after → ${ui.c.yellow(ttlMode)}`);
        paintStatus();
      } else {
        ui.err("usage: /ttl on_read|10s|60s");
      }
      setPrompt();
      return;
    }

    if (input.startsWith("/")) {
      ui.warn(`unknown command — try /help`);
      setPrompt();
      return;
    }

    if (!peerOnline || !sharedKey) {
      ui.warn("peer not connected — message not sent");
      setPrompt();
      return;
    }

    try {
      const messageId = generateMessageId();
      const wire = encryptToWire(sharedKey, input);
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
    const ttlIdx = args.indexOf("--ttl");
    if (ttlIdx >= 0 && args[ttlIdx + 1]) {
      const t = args[ttlIdx + 1]!;
      if (!isValidTtlMode(t)) {
        ui.err("invalid --ttl (use 10s|60s|on_read)");
        process.exit(1);
      }
      ttl = t;
    }
    ui.sys("creating room…");
    const { roomId } = await createRoom();
    process.stdout.write(
      ui.roomCreatedCard(roomId, `${WEB_ORIGIN}/r/${roomId}`)
    );
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
