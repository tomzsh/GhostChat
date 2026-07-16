# Changelog

All notable changes to GhostChat are documented in this file.

## [1.0.0] — 2026-07-16

### Added
- Anonymous ephemeral 1:1 E2EE chat (web + CLI)
- Cloudflare Workers + Durable Objects room relay
- Next.js 15 web UI (mobile-first, terminal theme)
- CLI with styled TUI (`ghost create` / `ghost join`)
- X25519 + HKDF-SHA256 + XChaCha20-Poly1305 crypto package
- Self-destruct messages (burn after read / 10s / 60s)
- Safety number for MITM detection
- QR join codes, share/copy room code
- Typing ASCII animation, relay health indicator
- Rate limiting (create / join probes)
- Unit tests (crypto, shared, rate limiter)
- Docs: `README.md` (EN) and `README.id.md` (ID)
