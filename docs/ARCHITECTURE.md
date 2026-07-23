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
  - Accepts up to `maxParticipants` (2–20) unique sessions.
  - Relays `message`, `typing`, `burn`, `mls_key_package`, `mls_welcome` (unicast), `mls_commit`.
  - Emits `joined`, `peer_joined`, `peer_left`, `room_closed`, `error`.
  - Replaced sockets tagged `__replaced` to avoid false leave events.
  - Alarms: empty grace, idle timeout, max age.
  - Never holds MLS group state or keys.

### `apps/cli`

- Same protocol and crypto as web.
- ANSI UI in `ui.ts`; session logic in `index.ts`.

### Packages

| Package | Role |
|---|---|
| `shared` | IDs, limits, TTL |
| `protocol` | Typed WS frames |
| `crypto` | MLS (RFC 9420) + legacy pairwise helpers + safety number |

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

## Message path (MLS)

1. First member `createGroup`; joiners broadcast `mls_key_package`.
2. Committer `createCommit(Add)` → unicast `mls_welcome` + broadcast `mls_commit`.
3. Chat: `createApplicationMessage` → WS `message` (MLS PrivateMessage).
4. Peers `processPrivateMessage`; optional `burn` syncs UI deletion.
5. On leave, committer may `Remove` + broadcast `mls_commit`.

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
- MLS: keep server crypto-free; change wire types in `packages/protocol` first.
