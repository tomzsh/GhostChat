# Contributing

Thanks for contributing to GhostChat.

## For humans

1. Read [README.md](./README.md) (or [README.id.md](./README.id.md)).
2. Use **pnpm** and Node ≥ 20.
3. Keep the privacy model: no server-side message storage or private keys.
4. Run `pnpm typecheck` and `pnpm test` before opening a PR.

## For AI agents

Read **[AGENTS.md](./AGENTS.md)** — required.

## Workflow

```bash
pnpm install
pnpm build:packages
# make changes
pnpm typecheck
pnpm test
```

## Pull requests

- Describe *why*, not only *what*.
- Note protocol/breaking changes explicitly.
- Do not commit `.env.local`, secrets, or build artifacts (`dist`, `.next`).
