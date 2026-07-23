# Changelog

All notable changes to GhostChat are documented in this file.

## [2.0.1] — 2026-07-23

### Fixed
- Ignore stale MLS commits after Welcome (`epoch too old` false error in UI)
- Committer election excludes pending joiners (join deadlock)
- Sequential `addMember` uses latest epoch state; MLS ops on a serial queue
- Skip re-adding peers already in the ratchet tree (KP retries)

## [2.0.0] — 2026-07-23

### Breaking
- **MLS (RFC 9420)** replaces shared room AEAD key + ECDH `key_share`
- Wire protocol **`v: 2`** — frames: `mls_key_package`, `mls_welcome`, `mls_commit`
- Application messages are MLS PrivateMessages (`nonce: "mls"`)
- Safety number is epoch-bound (`confirmedTranscriptHash`)

### Added
- `packages/crypto` MLS API (`createMlsSession`, `addMember`, `acceptWelcome`, …) via **ts-mls**
- Ciphersuite: `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`
- Committer election (lexicographic display id) for Add/Remove
- KeyPackage retry while waiting for Welcome
- Unit test: 3-party join + message + remove

### Notes
- Server still never sees plaintext or private keys
- `ts-mls` is not formally audited — use at your own risk for high-threat scenarios
- v1.1 clients cannot join v2 rooms (ephemeral — no migration)

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
