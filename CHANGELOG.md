# Changelog

All notable changes to GhostChat are documented in this file.

## [1.1.0] — 2026-07-23

### Added
- **Group chat**: creator sets max members (2–20) at room creation
- Shared **room AEAD key** distributed via ECDH `key_share` to each joiner
- Web: max-members presets on landing; member list + capacity in room UI
- CLI: `ghost create --max N`
- Protocol: `peers[]` on `joined`, `peerId` on `peer_left`, `key_share` / `key_request` frames
- **Multi-typing**: track multiple peers typing; chips + status show who is typing
- **Key recovery**: clients retry `key_share` and send `key_request` while waiting for the room key

### Notes
- Group E2EE is a shared room key (not full MLS). Safety number is the room key fingerprint.

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
