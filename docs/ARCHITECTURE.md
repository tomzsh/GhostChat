# Architecture

Human- and agent-oriented system design for GhostChat.  
Operational rules for agents: see [AGENTS.md](../AGENTS.md).

## Goals

1. Zero-knowledge relay: server cannot read messages.
2. Ephemeral rooms: no durable chat history.
3. Identical protocol for web and CLI clients.
4. Minimal operational surface (one DO per room).

## Components

### `apps/web` (Next.js 15)

- **Landing** creates rooms via `POST /api/rooms` (rewritten to worker) and joins via code.
- **Room page** mounts `useGhostRoom`, which owns WebSocket lifecycle, key agreement, encrypt/decrypt, TTL burn, typing.
- Session tokens and display IDs live in `sessionStorage` (per tab).
- Keypairs cached in module memory (`lib/keys.ts`) for Strict Mode remounts.

### `apps/worker` (Cloudflare)

- HTTP router: create room, status, health, WebSocket upgrade.
- Rate limits (in-isolate sliding window) on create and join probes.
- **RoomDurableObject**:
  - Accepts up to 2 live sessions.
  - Relays `message`, `typing`, `burn`.
  - Emits `joined`, `peer_joined`, `peer_left`, `room_closed`, `error`.
  - Replaced sockets tagged `__replaced` to avoid false leave events.
  - Alarms: empty grace, idle timeout, max age.

### `apps/cli`

- Same protocol and crypto as web.
- ANSI UI in `ui.ts`; session logic in `index.ts`.

### Packages

| Package | Role |
|---|---|
| `shared` | IDs, limits, TTL |
| `protocol` | Typed WS frames |
| `crypto` | Client-side E2EE + safety number |

## Trust boundaries

```
[Browser/CLI process]  --ciphertext + public keys-->  [Worker/DO]
        ^                                                   |
        |______________ never returns plaintext ____________|
```

Attack surface of interest:

- Room code as sole access credential (share carefully).
- MITM on first join if code channel is hostile → safety number comparison.
- Endpoint compromise → out of scope.

## Message path

1. Client A encrypts with shared key → WS `message` frame.
2. DO validates rate/size/TTL mode, finds live peer sockets.
3. DO forwards frame to peer(s).
4. Client B decrypts; optional `burn` syncs UI deletion.

## Lifecycle

| Event | Result |
|---|---|
| Both peers disconnect | Empty grace → room destroyed |
| Idle (no activity) | 10 minutes → destroyed |
| Age | 24 hours → destroyed |
| Explicit leave (web Close / CLI `/quit`) | Socket close; may empty room |

## Extension guidelines

- New control frames: add to `packages/protocol` first, then worker + both clients.
- New crypto: keep behind `packages/crypto` API; add tests.
- New UI: keep mobile `app-shell` height model intact.
- Group chat: design MLS (or equivalent) before coding slots > 2.
