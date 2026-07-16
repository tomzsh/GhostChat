# GhostChat

**English** · [Bahasa Indonesia](./README.id.md)

Anonymous, **ephemeral**, **end-to-end encrypted** 1:1 chat.  
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

GhostChat solves a narrow problem: **talk to one other person, right now, privately, and leave no durable trace**.

| Concern | Behavior |
|---|---|
| Identity | Random `Anon-XXXX` per session — no signup |
| Storage | No message history on the server |
| Encryption | X25519 + HKDF-SHA256 + XChaCha20-Poly1305 on clients |
| Room access | 6-character code (or link / QR) |
| Lifecycle | Destroyed when empty, idle 10 min, or max age 24 h |

Clients: **Web (Next.js)** and **CLI (`ghost`)** share the same Cloudflare Worker backend.

---

## Features

### Product (MVP)

- Create / join 1:1 rooms (max 2 participants)
- Realtime chat over WebSocket
- End-to-end encryption (keys never leave the client)
- Typing indicator + animated ASCII “people chatting” (web)
- Message self-destruct (**Burn after**: read / 10s / 60s)
- **Safety number** — both peers compare digits to detect MITM
- **QR code** join URL (web)
- Copy / native share of room code
- Close room (explicit leave)
- Relay health indicator on landing
- Polished terminal CLI UI

### Infrastructure

- Cloudflare Workers + Durable Objects (one DO = one room)
- WebSocket Hibernation-friendly room design
- Rate limits: room create & join probes per IP
- Same-origin REST via Next.js rewrites in local/production web
- Unit tests for crypto, shared utils, rate limiter

---

## Architecture

```
┌──────────────┐         WSS          ┌─────────────────────────────┐
│  Web Client  │ ───────────────────▶ │  Cloudflare Worker          │
│  (Next.js)   │         HTTPS        │  POST/GET /api/rooms        │
└──────────────┘                      │  WS   /ws/:roomId           │
                                      │            │                │
┌──────────────┐         WSS          │            ▼                │
│  CLI Client  │ ───────────────────▶ │  Durable Object: Room       │
│  (Node.js)   │                      │  · connections (max 2)      │
└──────────────┘                      │  · relay ciphertext only    │
                                      └─────────────────────────────┘
         Private keys & plaintext never leave the client
```

**Data flow (message):**

1. Peer A encrypts plaintext with the shared AEAD key → `ciphertext` + `nonce`
2. Worker Durable Object forwards the frame to peer B (no decryption)
3. Peer B decrypts locally; optional TTL/`burn` syncs UI destruction

---

## Repository layout

```
ghostchat/
├── apps/
│   ├── web/                 # Next.js 15 (App Router) + Tailwind
│   ├── worker/              # Cloudflare Worker + Room Durable Object
│   └── cli/                 # ghost create | ghost join
├── packages/
│   ├── crypto/              # X25519, HKDF, XChaCha20-Poly1305, safety number
│   ├── protocol/            # Shared WS message types & parsers
│   └── shared/              # Room codes, limits, TTL helpers
├── package.json             # pnpm workspace root
├── README.md                # This file (English)
└── README.id.md             # Bahasa Indonesia
```

---

## Requirements

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| pnpm | 9.x (see `packageManager` in root `package.json`) |
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

Then open the web UI, **Create Room**, share the code/QR with a second browser or the CLI.

---

## Web app

### Pages

| Route | Description |
|---|---|
| `/` | Landing: create room, join by code, relay status |
| `/r/[roomId]` | Chat room: messages, TTL, QR, safety number |

### UX notes

- **Mobile-first** layout, safe areas, large touch targets
- **Burn after** selector (not raw “TTL”) with short helper text
- **Safety number** appears when the encrypted channel is ready — both sides must match
- **QR** encodes `https://<origin>/r/<ROOM_ID>` for camera scan-to-join
- Session identity uses `sessionStorage` only (not `localStorage`)

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
pnpm --filter @ghostchat/cli start create --ttl 10s   # 10s | 60s | on_read

# Join an existing room
pnpm --filter @ghostchat/cli start join AB92KF
```

### In-session commands

| Command | Action |
|---|---|
| `/ttl on_read\|10s\|60s` | Change burn mode for outgoing messages |
| `/who` / `/status` | Status bar + safety number |
| `/safety` / `/fp` | Show safety number only |
| `/help` | Command list |
| `/quit` | Leave room |

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
| `POST` | `/api/rooms` | Create room → `{ roomId, wsUrl }` |
| `GET` | `/api/rooms/:id` | Status: `ok` / `not_found` / full flag |
| `GET` | `/health` | Liveness `{ ok: true }` |

### WebSocket

| Path | Description |
|---|---|
| `/ws/:roomId` | Upgrade; first frame must be `join` |

### Limits (defaults)

| Limit | Value |
|---|---|
| Max participants / room | 2 |
| Max messages / connection / second | 5 |
| Max ciphertext size (approx) | 4 KB |
| Create rooms / IP / minute | 10 |
| Join probes (GET + WS) / IP / minute | 30 |
| Idle timeout | 10 minutes |
| Max room age | 24 hours |
| Empty-room grace | 30 seconds |

Configured in `packages/shared` (`LIMITS`) and enforced in the worker.

### Durable Object

- Class: `RoomDurableObject` (`apps/worker/src/room.ts`)
- Addressing: `idFromName(roomId)`
- Stores **no message content** — only short-lived metadata / alarms
- Sessions are unique by client `sessionToken` (reconnect-safe)

---

## Protocol

All frames are JSON with `"v": 1`.

**Client → server (examples):**

```json
{ "v": 1, "type": "join", "displayId": "Anon-4XJ9", "publicKey": "<base64>", "sessionToken": "..." }
{ "v": 1, "type": "message", "ciphertext": "...", "nonce": "...", "ttlMode": "60s", "messageId": "m_..." }
{ "v": 1, "type": "typing", "state": true }
{ "v": 1, "type": "burn", "messageId": "m_..." }
{ "v": 1, "type": "ping" }
```

**Server → client (examples):**

```json
{ "v": 1, "type": "joined", "yourId": "Anon-4XJ9", "peerId": null, "peerPublicKey": null, "sessionToken": "..." }
{ "v": 1, "type": "peer_joined", "peerId": "Anon-7QW2", "peerPublicKey": "..." }
{ "v": 1, "type": "message", "from": "Anon-7QW2", "ciphertext": "...", "nonce": "...", "ttlMode": "60s", "messageId": "m_..." }
{ "v": 1, "type": "error", "code": "room_full" }
{ "v": 1, "type": "room_closed", "reason": "idle_timeout" }
```

Shared TypeScript types live in `packages/protocol`.

---

## Cryptography

| Step | Algorithm | Library |
|---|---|---|
| Key agreement | X25519 ECDH | `@noble/curves` |
| KDF | HKDF-SHA256 (`info = ghostchat:<roomId>`) | `@noble/hashes` |
| AEAD | XChaCha20-Poly1305 (24-byte nonce) | `@noble/ciphers` |
| Safety number | SHA-256 of shared key → `XXXXX XXXXX XXXXX` | `@noble/hashes` |

**Rules:**

- Private keys stay in process / tab memory only
- Server sees public keys + ciphertext + presence metadata only
- Safety number must match on both devices; if not, treat the channel as compromised

---

## Security model

### Protected

- Network eavesdroppers / server operators cannot read message plaintext
- No durable message store to subpoena after the room is gone
- No account graph tying chats to email/phone

### Not protected

- Compromised endpoints (malware, screen capture)
- Anyone who knows the room code can join as the second peer — **the code is the secret**
- MITM during first key exchange if the code channel is hostile (mitigate with **safety number**)
- Legal/abuse content — server cannot moderate ciphertext

### Operational mitigations

- Rate limits on create/join
- Short room lifetime
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
| `@ghostchat/crypto` | ECDH agreement, AEAD encrypt/decrypt, tamper, safety number |
| `@ghostchat/shared` | Room IDs, TTL parsing |
| `@ghostchat/worker` | Sliding-window rate limiter |

Manual E2E ideas:

1. Web create → CLI join → bidirectional chat  
2. CLI create → Web join via code or QR  
3. Compare safety numbers  
4. Refresh one tab — session should reconnect without “room full”  
5. Close room — peer sees leave / room lifecycle  

---

## Deploy

### Worker (Cloudflare)

```bash
cd apps/worker
# set PUBLIC_WS_ORIGIN=wss://your-subdomain.workers.dev in wrangler.toml or dashboard
pnpm deploy
```

Requires a Workers plan that supports **Durable Objects**.

### Web (e.g. Vercel)

1. Root or `apps/web` as the project directory  
2. Build: `pnpm build` (from monorepo) or Next build with workspace packages  
3. Env:
   - `NEXT_PUBLIC_WS_URL=wss://your-worker…`
   - `WORKER_URL=https://your-worker…` (for rewrites)
   - optionally `NEXT_PUBLIC_API_URL=https://your-worker…`

Configure CORS on the worker if the browser calls the worker origin directly (rewrites avoid this for REST).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| “relay offline” on landing | Worker not running | `pnpm dev:worker` |
| WebSocket errors | Wrong host / IPv6 | Use `127.0.0.1` in `NEXT_PUBLIC_WS_URL` |
| Stuck “waiting for peer” | Old double-session bug / peer got `room_full` | Hard refresh; use latest code; one tab per peer |
| Cannot send | Peer left / no shared key | Wait for peer; check safety number after rejoin |
| Room not found | Expired or wrong code | Create a new room (max age / empty grace) |
| Rate limited | Too many creates/joins | Wait ~1 minute |
| CLI cannot connect | Worker down or env wrong | Check `GHOST_API_URL` / `GHOST_WS_URL` |

---

## Roadmap

Possible later work (not required for MVP):

- Production deploy checklist & multi-env configs  
- PWA / installable web app  
- Longer reconnect grace on the server  
- Optional room passphrase  
- In-app QR scanner  
- Group chat (requires MLS or similar — not a simple slot increase)

Out of scope by design: accounts, cloud history, push notifications, server-side content moderation of plaintext.

---

## License

Private / unspecified unless you add a license file. Add an SPDX license before publishing.

---

**GhostChat** — talk once. Leave nothing.
