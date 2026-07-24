# GhostChat

<p align="center">
  <img src="docs/assets/cover.png" alt="GhostChat — Anonymous. Encrypted. Gone." width="100%" />
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.id.md">Bahasa Indonesia</a>
  · <a href="https://github.com/tomzsh/GhostChat/releases/tag/v2.5.0">v2.5.0</a>
  · <a href="https://ghostchat-web-two.vercel.app/">Live demo</a>
</p>

Anonymous, **ephemeral**, **end-to-end encrypted** chat for **1:1 and small groups** (MLS).  
No accounts. No permanent history. No plaintext on the server.

> Privacy by design: the server is only a **relay** for ciphertext. When a room is empty, its in-memory state is destroyed.

**AI / coding agents:** start at **[AGENTS.md](./AGENTS.md)** (architecture map, hard rules, commands).

---

## Table of contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Repository layout](#repository-layout)
5. [Requirements](#requirements)
6. [Quick start](#quick-start)
7. [Web app](#web-app)
8. [CLI](#cli)
9. [Worker / API](#worker--api)
10. [Protocol](#protocol)
11. [Cryptography](#cryptography)
12. [Security model](#security-model)
13. [Configuration](#configuration)
14. [Scripts](#scripts)
15. [Testing](#testing)
16. [Deploy](#deploy)
17. [Troubleshooting](#troubleshooting)
18. [Roadmap](#roadmap)
19. [License](#license)

---

## Overview

GhostChat solves a narrow problem: **talk privately right now, and leave no durable trace**.

| Concern | Behavior |
|---|---|
| Identity | Random `Anon-XXXX` per session — no signup |
| Storage | No message history on the server |
| Encryption | **MLS (RFC 9420)** on clients (`ts-mls`); server relays ciphertext only |
| Room access | 6-character code (or link / QR); creator sets max members **2–20** |
| Invite hygiene | **Room code rotates** when someone leaves so old links stop working |
| Lifecycle | Destroyed when empty, idle 10 min, or max age 24 h |

Clients: **Web (Next.js)** and **CLI (`ghost`)** share the same Cloudflare Worker backend.

---

## Features

### Product

- Create / join rooms (**2–20** members, creator chooses)
- Realtime chat over WebSocket with **MLS** group E2EE
- **Invite code rotation** on leave (remaining peers get a new share/QR code)
- Burn modes: **after read · 10s · 60s · when I leave**
- **Safety number** (epoch-bound) to detect MITM
- **Ephemeral images** — client JPEG compress (≤1MB), chunked E2EE send
- **Animated ASCII emoji** picker (web)
- Multi-peer typing chips + presence ASCII banners (web)
- QR join, copy / native share of room code
- Close-room modal (ASCII terminal style)
- Relay health indicator on landing
- Polished terminal CLI UI

### Infrastructure

- Cloudflare Workers + Durable Objects (one room DO + invite alias DOs)
- WebSocket hibernation-friendly room design
- Rate limits: room create & join probes per IP
- Same-origin REST via Next.js rewrites (`/api/*` → worker)
- Unit tests for crypto, shared utils, rate limiter

---

## Architecture

```
┌──────────────┐         WSS          ┌─────────────────────────────┐
│  Web Client  │ ───────────────────▶ │  Cloudflare Worker          │
│  (Next.js)   │         HTTPS        │  POST/GET /api/rooms        │
└──────────────┘                      │  GET  /api/health|/health   │
                                      │  WS   /ws/:roomId           │
┌──────────────┐         WSS          │            │                │
│  CLI Client  │ ───────────────────▶ │            ▼                │
│  (Node.js)   │                      │  Durable Object: Room       │
└──────────────┘                      │  · max 2–20 sessions        │
                                      │  · relay ciphertext only    │
                                      │  · rotate public invite     │
                                      └─────────────────────────────┘
         Private keys & plaintext never leave the client
```

**Data flow (message):**

1. Client encrypts application data with **MLS** → `ciphertext` (`nonce: "mls"`)
2. Worker Durable Object forwards the frame (no decryption)
3. Peers decrypt locally; optional TTL / `burn` syncs UI destruction
4. Images are compressed, then sent as **paced MLS chunks** and reassembled in memory

---

## Repository layout

```
ghostchat/
├── apps/
│   ├── web/                 # Next.js 15 (App Router) + Tailwind
│   ├── worker/              # Cloudflare Worker + Room Durable Object
│   └── cli/                 # ghost create | ghost join
├── packages/
│   ├── crypto/              # MLS (ts-mls) + legacy pairwise helpers
│   ├── protocol/            # Shared WS message types & parsers
│   └── shared/              # Room codes, limits, TTL, app payloads
├── docs/
│   ├── ARCHITECTURE.md
│   ├── cover.svg            # Cover source
│   └── assets/cover.png     # README banner
├── AGENTS.md                # Guide for AI coding agents
├── package.json             # pnpm workspace root
├── README.md                # This file (English)
└── README.id.md             # Bahasa Indonesia
```

---

## Requirements

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| pnpm | 9+ (see `packageManager` in root `package.json`) |
| Cloudflare account | Only for production deploy of the worker |

---

## Quick start

```bash
# 1. Install
pnpm install

# 2. Build shared packages (also runs automatically on predev:*)
pnpm build:packages

# 3. Terminal A — relay
pnpm dev:worker
# → http://127.0.0.1:8787

# 4. Terminal B — web UI
pnpm dev:web
# → http://localhost:3000
```

Then open the web UI, **Create Room**, share the code/QR with another browser or the CLI.

---

## Web app

### Pages

| Route | Description |
|---|---|
| `/` | Landing: create room, join by code, relay status |
| `/r/[roomId]` | Chat room: messages, burn mode, QR, safety number, images, emoji |

### UX notes

- **Mobile-first** layout, safe areas, large touch targets
- **Burn after** selector (not raw “TTL”) with short helper text
- **Safety number** when the MLS group is ready — compare out-of-band
- **QR** encodes `https://<origin>/r/<CODE>`; code can rotate mid-session
- Session identity uses `sessionStorage` only (not `localStorage`)
- Images: always client-compressed JPEG, then chunked E2EE

### Local env (`apps/web/.env.local`)

```bash
# Optional. If unset, REST uses same-origin /api/* rewrites → worker.
# NEXT_PUBLIC_API_URL=http://127.0.0.1:8787

# WebSocket must be absolute
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8787

# Server-side rewrite target (Next config)
# WORKER_URL=http://127.0.0.1:8787
```

Copy from `apps/web/.env.example` if needed.

Prefer **`127.0.0.1`** over `localhost` for the worker URL so browsers do not hit IPv6 `::1` while Wrangler listens on IPv4.

---

## CLI

```bash
# Create a room and enter the session
pnpm --filter @ghostchat/cli start create
pnpm --filter @ghostchat/cli start create --max 6
pnpm --filter @ghostchat/cli start create --ttl on_leave

# Join an existing room
pnpm --filter @ghostchat/cli start join AB92KF
```

### In-session commands

| Command | Action |
|---|---|
| `/ttl on_read\|10s\|60s\|on_leave` | Burn mode for outgoing messages |
| `/who` / `/status` | Status bar + safety number |
| `/safety` / `/fp` | Show safety number only |
| `/help` | Command list |
| `/quit` | Leave room (triggers invite rotation for others) |

### Environment

| Variable | Default |
|---|---|
| `GHOST_API_URL` | `http://127.0.0.1:8787` |
| `GHOST_WS_URL` | derived from API (`http` → `ws`) |
| `GHOST_WEB_URL` | `http://127.0.0.1:3000` (link printed on create) |
| `NO_COLOR` | set to disable ANSI colors |

---

## Worker / API

### REST

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/rooms` | Create room → `{ roomId, wsUrl, maxParticipants }` |
| `GET` | `/api/rooms/:id` | Status: `ok` / `not_found` / full flag (+ `publicCode` / `internalId`) |
| `GET` | `/api/health` or `/health` | Liveness `{ ok: true, service: "ghostchat-worker" }` |

### WebSocket

| Path | Description |
|---|---|
| `/ws/:roomId` | Upgrade; first frame must be `join`. Resolves invite aliases. |

### Limits (defaults in `@ghostchat/shared` `LIMITS`)

| Limit | Value |
|---|---|
| Max participants / room | 2–20 (creator chooses; default 2) |
| Max messages / connection / second | 5 |
| Max image (compressed) | 1 MB |
| Image chunk size | ~24 KB (paced send) |
| Max ciphertext (wire) | ~2.5 MB |
| Create rooms / IP / minute | 10 |
| Join probes (GET + WS) / IP / minute | 30 |
| Idle timeout | 10 minutes |
| Max room age | 24 hours |
| Empty-room grace | 30 seconds |

### Durable Object

- Class: `RoomDurableObject` (`apps/worker/src/room.ts`)
- Room DO: stable **internal** id; public invite may be a separate **alias** DO (`a:CODE`)
- Stores **no message content** — only short-lived metadata / alarms
- Sessions unique by client `sessionToken` (reconnect-safe; Strict Mode safe)
- Explicit `leave` frame + socket close both rotate the invite when others remain

---

## Protocol

Wire major version: **`v: 2`** (MLS). Types live in `packages/protocol`.

**Client → server (examples):**

```json
{ "v": 2, "type": "join", "displayId": "Anon-4XJ9", "publicKey": "mls", "sessionToken": "..." }
{ "v": 2, "type": "message", "ciphertext": "...", "nonce": "mls", "ttlMode": "60s", "messageId": "m_..." }
{ "v": 2, "type": "typing", "state": true }
{ "v": 2, "type": "burn", "messageId": "m_..." }
{ "v": 2, "type": "mls_key_package", "package": "..." }
{ "v": 2, "type": "mls_welcome", "to": "Anon-…", "welcome": "..." }
{ "v": 2, "type": "mls_commit", "commit": "..." }
{ "v": 2, "type": "leave" }
{ "v": 2, "type": "ping" }
```

**Server → client (examples):**

```json
{ "v": 2, "type": "joined", "yourId": "Anon-4XJ9", "sessionToken": "...", "peers": [], "internalId": "…", "publicCode": "…" }
{ "v": 2, "type": "peer_joined", "peerId": "Anon-7QW2", "participantCount": 2 }
{ "v": 2, "type": "peer_left", "peerId": "Anon-7QW2", "participantCount": 1, "publicCode": "NEWID1" }
{ "v": 2, "type": "room_code", "publicCode": "NEWID1" }
{ "v": 2, "type": "message", "from": "Anon-7QW2", "ciphertext": "...", "nonce": "mls", "ttlMode": "60s", "messageId": "m_..." }
{ "v": 2, "type": "error", "code": "room_full" }
{ "v": 2, "type": "room_closed", "reason": "idle_timeout" }
```

Application plaintext may be plain text, or structured payloads (`GCIMG1` / `GCIMGC1` images, `GCEMO1` emoji) defined in `@ghostchat/shared`.

---

## Cryptography

| Step | Algorithm | Library |
|---|---|---|
| Group E2EE | **MLS (RFC 9420)** | `ts-mls` |
| Ciphersuite | `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` | `ts-mls` / HPKE |
| Safety number | SHA-256 of MLS `confirmedTranscriptHash` | `@noble/hashes` |
| Protocol | `PROTOCOL_VERSION = 2` | `@ghostchat/protocol` |

**Rules:**

- Private keys and MLS group state stay in process / tab memory only
- Server sees MLS ciphertext + presence metadata only (never group secrets)
- Safety number is **epoch-bound** — re-compare after joins/leaves
- `ts-mls` is not formally audited — use at your own risk for high-threat scenarios

---

## Security model

### Protected

- Network eavesdroppers / server operators cannot read message plaintext
- No durable message store to subpoena after the room is gone
- No account graph tying chats to email/phone
- Departed members cannot rejoin with an old invite once the code rotated

### Not protected

- Compromised endpoints (malware, screen capture)
- Anyone who knows the **current** room code can join (capacity permitting)
- MITM if the invite channel is hostile — mitigate with **safety number**
- Legal/abuse content — server cannot moderate ciphertext

### Operational mitigations

- Rate limits on create/join
- Short room lifetime
- Invite rotation on leave
- Optional peer comparison of safety numbers

---

## Configuration

### Worker (`apps/worker/wrangler.toml`)

| Binding / var | Purpose |
|---|---|
| `ROOMS` | Durable Object namespace |
| `PUBLIC_WS_ORIGIN` | `wsUrl` returned by create (e.g. `wss://….workers.dev`) |

Local dev binds `0.0.0.0:8787`.

### Web

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Optional absolute REST origin |
| `NEXT_PUBLIC_WS_URL` | Absolute WebSocket origin |
| `WORKER_URL` | Server-side rewrite target for `/api/*` |

---

## Scripts

From the monorepo root:

| Script | Description |
|---|---|
| `pnpm install` | Install all workspaces |
| `pnpm build:packages` | Build `shared`, `protocol`, `crypto` |
| `pnpm build` | Packages + Next production build |
| `pnpm dev:worker` | Wrangler local worker |
| `pnpm dev:web` | Next dev server (port 3000) |
| `pnpm dev:cli` | CLI entry (`ghost`) |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm test` | Unit tests |
| `pnpm audit:local` | typecheck + test + web build |
| `pnpm clean` | Remove build artifacts |

`predev:web`, `predev:worker`, and `predev:cli` automatically run `build:packages`.

---

## Testing

```bash
pnpm test
```

| Package | Coverage |
|---|---|
| `@ghostchat/crypto` | MLS 2-/3-party join + message + remove; legacy AEAD helpers |
| `@ghostchat/shared` | Room IDs, TTL, image/emoji payloads, **chunk reassembly** |
| `@ghostchat/worker` | Sliding-window rate limiter |

Manual E2E ideas:

1. Web create (max 3) → two more clients join → chat  
2. One peer leaves → remaining peers see **new room code**; old code fails join  
3. Send compressed image → peer receives preview; burns with TTL  
4. Compare safety numbers after each join  
5. Refresh one tab — reconnect without false `peer_left` / room full  

---

## Deploy

### Worker (Cloudflare)

```bash
cd apps/worker
# set PUBLIC_WS_ORIGIN=wss://your-worker.subdomain.workers.dev
pnpm deploy
# or: wrangler deploy --name <worker> --var PUBLIC_WS_ORIGIN:wss://…
```

Requires a Workers plan that supports **Durable Objects**.

### Web (e.g. Vercel)

1. Root of the monorepo as the project directory  
2. Build: `pnpm build`  
3. Env:
   - `NEXT_PUBLIC_WS_URL=wss://your-worker…`
   - `WORKER_URL=https://your-worker…` (for `/api/*` rewrites)
   - optionally `NEXT_PUBLIC_API_URL=https://your-worker…`

Health probe uses same-origin `/api/health` → rewrite → worker `/api/health` (also accepts `/health`).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| “relay offline” (local) | Worker not running | `pnpm dev:worker` |
| “relay offline” (prod) | `WORKER_URL` wrong / rewrite miss | Point `WORKER_URL` at worker origin; ensure `/api/health` works |
| WebSocket errors | Wrong host / IPv6 | Prefer `127.0.0.1` locally; `wss://` in prod |
| Stuck “waiting for peer” | Room full / double session | One tab per peer; hard refresh |
| Code does not change on leave | Stale worker deploy | Redeploy worker (leave + rotate logic) |
| Cannot send image | Over size / not compressed | Max **1MB** after compress; wait for MLS ready |
| Room not found | Expired, rotated, or wrong code | Use the **current** share code |
| Rate limited | Too many creates/joins | Wait ~1 minute |
| CLI cannot connect | Worker down or env wrong | Check `GHOST_API_URL` / `GHOST_WS_URL` |

---

## Roadmap

Possible later work:

- Multi-env deploy configs  
- PWA / installable web  
- Longer reconnect grace  
- Optional room passphrase  
- In-app QR scanner  
- Post-quantum MLS ciphersuites (X-Wing / ML-KEM)

Out of scope by design: accounts, cloud history, push notifications, server-side content moderation of plaintext.

---

## License

Private / unspecified unless you add a license file. Add an SPDX license before publishing.

---

**GhostChat** — talk once. Leave nothing.
