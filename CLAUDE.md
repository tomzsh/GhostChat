# Claude Code

Read **[AGENTS.md](./AGENTS.md)** first — it is the source of truth for agents working on this repo.

Quick facts:

- pnpm monorepo: `apps/{web,worker,cli}` + `packages/{crypto,protocol,shared}`
- Privacy: server relays ciphertext only; no message storage
- After package edits: `pnpm build:packages`
- Verify: `pnpm typecheck && pnpm test`
- Local: `pnpm dev:worker` + `pnpm dev:web`
