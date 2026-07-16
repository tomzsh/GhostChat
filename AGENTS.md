# AGENTS.md — Guide for AI coding agents

This file is the **primary entrypoint** for automated coding agents (Cursor, Claude Code, Copilot, Codex, Continue, Aider, etc.). Humans: see [README.md](./README.md) / [README.id.md](./README.id.md).

---

## Project in one paragraph

**GhostChat** is a monorepo for **anonymous, ephemeral, 1:1 end-to-end encrypted chat**. Clients: Next.js web + Node CLI. Backend: Cloudflare Worker + Durable Objects (ciphertext relay only — no message storage). Privacy principles override feature creep.

**Version:** 1.0.0 · **Package manager:** pnpm 9 · **Node:** ≥ 20

---

## Hard rules (do not violate)

1. **Never store message plaintext or private keys on the server.** Worker only relays ciphertext + presence metadata.
2. **Never write chat history to Durable Object storage, D1, KV, or logs.** Storage may hold short-lived room meta/alarms only.
3. **Do not add accounts, persistent identity, or multi-device sync** without an explicit product decision (conflicts with ephemeral design).
4. **Do not implement group chat (>2) with plain multi-ECDH** — needs MLS/sender keys; out of MVP scope.
5. **Do not commit secrets:** `.env`, `.env.local`, `.dev.vars`, API keys, Cloudflare tokens.
6. **Do not expand scope** into file sharing / push / moderation of ciphertext unless asked.
7. Prefer **editing existing files** over new dependencies. Justify any new package.
8. Keep **protocol types** in `packages/protocol` as the single source of truth for WS frames.

---

## Monorepo map

```
ghostchat/
├── apps/
│   ├── web/          # Next.js 15 App Router UI (port 3000)
│   ├── worker/       # Cloudflare Worker + RoomDurableObject (port 8787)
│   └── cli/          # `ghost create` | `ghost join`
├── packages/
│   ├── crypto/       # X25519, HKDF, XChaCha20-Poly1305, safety number
│   ├── protocol/     # ClientMessage / ServerMessage types + parsers
│   └── shared/       # room codes, LIMITS, TTL helpers
├── AGENTS.md         # ← you are here
├── README.md         # English docs
└── README.id.md      # Indonesian docs
```

| Package / app | Import name | Responsibility |
|---|---|---|
| `packages/shared` | `@ghostchat/shared` | `generateRoomId`, `LIMITS`, `TtlMode`, alphabet |
| `packages/protocol` | `@ghostchat/protocol` | WS JSON schema, `parseClientMessage` |
| `packages/crypto` | `@ghostchat/crypto` | Key exchange, AEAD, `safetyNumberFromKey` |
| `apps/worker` | — | HTTP + WS routing, DO room lifecycle |
| `apps/web` | — | UI, `useGhostRoom`, session keys |
| `apps/cli` | — | Terminal client + ANSI UI |

**Dependency direction:** `web` / `cli` / `worker` → `protocol` / `shared` / `crypto` (worker does **not** use crypto).  
Always build packages after changing them: `pnpm build:packages`.

---

## Critical source files

| Path | When to edit |
|---|---|
| `packages/protocol/src/index.ts` | Add/change WS message types |
| `packages/crypto/src/index.ts` | Encryption / safety number |
| `packages/shared/src/index.ts` | Limits, room ID rules, TTL |
| `apps/worker/src/index.ts` | REST routes, rate limits, CORS |
| `apps/worker/src/room.ts` | Room DO: join, relay, peer_left, alarms |
| `apps/worker/src/rateLimit.ts` | Sliding-window limiter |
| `apps/web/src/hooks/useGhostRoom.ts` | Client WS session, E2EE state machine |
| `apps/web/src/components/RoomChat.tsx` | Room UI/UX |
| `apps/web/src/lib/session.ts` | sessionStorage identity (tab-scoped) |
| `apps/web/src/lib/keys.ts` | In-memory keypair cache (Strict Mode safe) |
| `apps/web/next.config.ts` | Rewrites `/api/*` → worker |
| `apps/cli/src/index.ts` + `ui.ts` | CLI behavior + styling |
| `apps/worker/wrangler.toml` | DO bindings, local port, `PUBLIC_WS_ORIGIN` |

---

## Commands agents should run

```bash
# Install
pnpm install

# Build shared packages (required after package/* edits)
pnpm build:packages

# Typecheck everything
pnpm typecheck

# Unit tests (crypto + shared + rate limiter)
pnpm test

# Full local gate
pnpm audit:local

# Dev (two processes)
pnpm dev:worker    # http://127.0.0.1:8787
pnpm dev:web       # http://localhost:3000

# CLI
pnpm --filter @ghostchat/cli start create
pnpm --filter @ghostchat/cli start join <ROOM_ID>
```

| Filter | Path |
|---|---|
| `@ghostchat/web` | `apps/web` |
| `@ghostchat/worker` | `apps/worker` |
| `@ghostchat/cli` | `apps/cli` |
| `@ghostchat/crypto` | `packages/crypto` |
| `@ghostchat/protocol` | `packages/protocol` |
| `@ghostchat/shared` | `packages/shared` |

---

## Architecture constraints (read before changing behavior)

### Room model
- One Durable Object instance per `roomId` via `idFromName(roomId)`.
- Max **2 unique `sessionToken`s** (not raw sockets — Strict Mode / reconnect creates multiple sockets).
- Session reconnect: mark old socket `__replaced` — **must not** emit false `peer_left`.
- Destroy room: empty (after grace), idle 10m, max age 24h.

### Client session (web)
- `sessionStorage` keys: `ghostchat:session:<roomId>`, `ghostchat:display:<roomId>`.
- Keypairs cached in module map (`lib/keys.ts`) so React Strict Mode remounts reuse keys.
- Always send `sessionToken` on first join (pre-create client-side) to avoid double-session / room_full.

### Crypto
- ECDH X25519 → HKDF-SHA256 with `info = ghostchat:<roomId>` → XChaCha20-Poly1305.
- Safety number = formatted SHA-256 of shared key; both peers must match.
- Nonce 24 bytes per message; never reuse.

### Networking
- REST (browser): prefer same-origin `/api/*` (Next rewrites → worker).
- WebSocket: absolute URL (`NEXT_PUBLIC_WS_URL`, default `ws://127.0.0.1:8787`).
- Prefer `127.0.0.1` over `localhost` (IPv6 issues).

### Limits (`@ghostchat/shared` `LIMITS`)
- 5 msg/s/connection, ~4KB ciphertext, 10 creates/min/IP, 30 join probes/min/IP.

---

## UI / UX conventions (web)

- **Mobile-first:** room shell uses fixed `app-shell` height + `visualViewport` (`--app-height`).
- Terminal theme: bg `#0a0a0a`, accent `#33ff66`, monospace.
- Touch targets ~44px; inputs ≥16px on mobile (iOS zoom).
- Labels: **Burn after** (not raw “TTL”) in user-facing copy.
- Do not break safe-area handling (`safe-top` / `safe-bottom`).

---

## Testing expectations

After meaningful changes:

1. `pnpm typecheck`
2. `pnpm test`
3. If web UI changed: sanity-check room create/join mentally; prefer `pnpm --filter @ghostchat/web build` for compile.

Add unit tests next to packages when changing crypto or limits.

---

## Common failure modes (fix here first)

| Bug | Cause | Fix location |
|---|---|---|
| Cannot send | `peer_left` cleared shared key after reconnect | `room.ts` `__replaced` handling; client session token |
| Waiting for peer forever | Double session filled room | Client pre-create token; status uses unique sessions |
| WS fails | Wrong host / worker down | `lib/config.ts`, wrangler dev |
| Decrypt fail | Keypair rotated mid-session | `lib/keys.ts` stable keypair |
| Room full on second tab same browser | Shared sessionStorage is per-tab OK; same token in two tabs replaces | Document: use two browsers for 2 peers |

---

## What “done” looks like for a change

- [ ] Protocol/types updated if wire format changed
- [ ] Packages built if `packages/*` edited
- [ ] Typecheck clean
- [ ] Tests pass (or new tests added)
- [ ] No secrets committed
- [ ] Ephemeral / zero-knowledge principles preserved
- [ ] Mobile layout still usable if UI touched

---

## Docs index

| File | Audience |
|---|---|
| [AGENTS.md](./AGENTS.md) | AI agents (this file) |
| [README.md](./README.md) | Humans (English) |
| [README.id.md](./README.id.md) | Humans (Indonesian) |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [.github/copilot-instructions.md](./.github/copilot-instructions.md) | GitHub Copilot |
| [CLAUDE.md](./CLAUDE.md) | Claude Code pointer |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Deeper system design |

---

## Out of scope unless explicitly requested

- User accounts, OAuth, email
- Group chat / MLS
- File/media storage
- Push notifications
- Server-side message search or moderation of plaintext
- Switching off E2EE “for convenience”
