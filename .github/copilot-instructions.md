# GitHub Copilot instructions — GhostChat

Follow **[AGENTS.md](../AGENTS.md)** at the repository root for full rules.

## Essentials

- **pnpm** workspace only (not npm/yarn for installs).
- Shared types live in `packages/protocol`. Crypto in `packages/crypto`. Limits in `packages/shared`.
- Worker (`apps/worker`) must never decrypt or store messages.
- Web room state machine: `apps/web/src/hooks/useGhostRoom.ts`.
- After changing `packages/*`, run `pnpm build:packages`.
- Prefer `127.0.0.1` for local worker URLs (not `localhost`).
- Do not commit `.env.local` or secrets.

## Do not

- Add group chat without MLS design
- Add accounts / persistent chat history
- Log ciphertext bodies or room contents
