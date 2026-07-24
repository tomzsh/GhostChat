# GhostChat

<p align="center">
  <img src="docs/assets/cover.png" alt="GhostChat — Anonymous. Encrypted. Gone." width="100%" />
</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>Bahasa Indonesia</strong>
  · <a href="https://github.com/tomzsh/GhostChat/releases/tag/v2.5.0">v2.5.0</a>
  · <a href="https://ghostchat-web-two.vercel.app/">Demo live</a>
</p>

Chat **anonim**, **ephemeral**, **terenkripsi end-to-end** untuk **1:1 dan grup kecil** (MLS).  
Tanpa akun. Tanpa riwayat permanen. Tanpa plaintext di server.

> Privacy by design: server hanya **relay** ciphertext. Saat room kosong, state in-memory dihancurkan.

**AI / coding agents:** mulai dari **[AGENTS.md](./AGENTS.md)** (peta arsitektur, aturan keras, perintah).

---

## Daftar isi

1. [Ringkasan](#ringkasan)
2. [Fitur](#fitur)
3. [Arsitektur](#arsitektur)
4. [Struktur repositori](#struktur-repositori)
5. [Prasyarat](#prasyarat)
6. [Mulai cepat](#mulai-cepat)
7. [Aplikasi web](#aplikasi-web)
8. [CLI](#cli)
9. [Worker / API](#worker--api)
10. [Protokol](#protokol)
11. [Kriptografi](#kriptografi)
12. [Model keamanan](#model-keamanan)
13. [Konfigurasi](#konfigurasi)
14. [Skrip](#skrip)
15. [Pengujian](#pengujian)
16. [Deploy](#deploy)
17. [Pemecahan masalah](#pemecahan-masalah)
18. [Roadmap](#roadmap)
19. [Lisensi](#lisensi)

---

## Ringkasan

GhostChat menyelesaikan masalah spesifik: **ngobrol privat sekarang, tanpa meninggalkan jejak yang awet**.

| Aspek | Perilaku |
|---|---|
| Identitas | `Anon-XXXX` acak per sesi — tanpa registrasi |
| Penyimpanan | Tidak ada riwayat pesan di server |
| Enkripsi | **MLS (RFC 9420)** di client (`ts-mls`); server hanya relay ciphertext |
| Akses room | Kode 6 karakter (atau link / QR); creator set max anggota **2–20** |
| Kebersihan undangan | **Kode room berotasi** saat seseorang keluar |
| Siklus hidup | Musnah saat kosong, idle 10 menit, atau usia maks 24 jam |

Klien: **Web (Next.js)** dan **CLI (`ghost`)** memakai backend Cloudflare Worker yang sama.

---

## Fitur

### Produk

- Buat / join room (**2–20** anggota, dipilih creator)
- Chat realtime WebSocket dengan E2EE grup **MLS**
- **Rotasi kode undangan** saat leave (peer yang tinggal mendapat kode share/QR baru)
- Mode burn: **setelah dibaca · 10s · 60s · saat saya leave**
- **Safety number** (terikat epoch) untuk deteksi MITM
- **Gambar ephemeral** — compress JPEG client (≤1MB), kirim E2EE ter-chunk
- **Emoji ASCII** animasi (web)
- Multi typing + banner presence ASCII (web)
- QR join, salin / share native kode room
- Modal tutup room bergaya terminal ASCII
- Indikator kesehatan relay di landing
- **PWA** — bisa di-install (service worker cache UI saja, bukan chat/API)
- UI CLI bergaya terminal

### Infrastruktur

- Cloudflare Workers + Durable Objects (room DO + alias undangan)
- Desain room ramah WebSocket Hibernation
- Rate limit: buat room & probe join per IP
- REST same-origin lewat rewrite Next.js (`/api/*` → worker)
- Unit test crypto, shared, rate limiter

---

## Arsitektur

```
┌──────────────┐         WSS          ┌─────────────────────────────┐
│  Klien Web   │ ───────────────────▶ │  Cloudflare Worker          │
│  (Next.js)   │         HTTPS        │  POST/GET /api/rooms        │
└──────────────┘                      │  GET  /api/health|/health   │
                                      │  WS   /ws/:roomId           │
┌──────────────┐         WSS          │            │                │
│  Klien CLI   │ ───────────────────▶ │            ▼                │
│  (Node.js)   │                      │  Durable Object: Room       │
└──────────────┘                      │  · sesi 2–20                │
                                      │  · hanya relay ciphertext   │
                                      │  · rotasi invite publik     │
                                      └─────────────────────────────┘
         Kunci privat & plaintext tidak pernah meninggalkan client
```

**Alur pesan:**

1. Client mengenkripsi data aplikasi dengan **MLS** → `ciphertext` (`nonce: "mls"`)
2. Durable Object meneruskan frame (tanpa dekripsi)
3. Peer mendekripsi di lokal; TTL / `burn` menyelaraskan hapus di UI
4. Gambar di-compress, dikirim **chunk MLS ber-pace**, dirakit di memori

---

## Struktur repositori

```
ghostchat/
├── apps/
│   ├── web/                 # Next.js 15 (App Router) + Tailwind
│   ├── worker/              # Cloudflare Worker + Room Durable Object
│   └── cli/                 # ghost create | ghost join
├── packages/
│   ├── crypto/              # MLS (ts-mls) + helper pairwise legacy
│   ├── protocol/            # Tipe & parser pesan WebSocket
│   └── shared/              # Kode room, limit, TTL, payload app
├── docs/
│   ├── ARCHITECTURE.md
│   ├── cover.svg            # Sumber cover
│   └── assets/cover.png     # Banner README
├── AGENTS.md                # Panduan agen AI
├── package.json             # Root workspace pnpm
├── README.md                # English
└── README.id.md             # Dokumen ini
```

---

## Prasyarat

| Alat | Versi |
|---|---|
| Node.js | ≥ 20 |
| pnpm | 9+ (lihat `packageManager` di root) |
| Akun Cloudflare | Hanya untuk deploy worker produksi |

---

## Mulai cepat

```bash
# 1. Instal dependensi
pnpm install

# 2. Build package bersama (otomatis juga lewat predev:*)
pnpm build:packages

# 3. Terminal A — relay
pnpm dev:worker
# → http://127.0.0.1:8787

# 4. Terminal B — UI web
pnpm dev:web
# → http://localhost:3000
```

Buka web, **Create Room**, bagikan kode/QR ke browser lain atau CLI.

---

## Aplikasi web

### Halaman

| Rute | Deskripsi |
|---|---|
| `/` | Landing: buat room, join kode, status relay |
| `/r/[roomId]` | Room chat: pesan, burn, QR, safety, gambar, emoji |

### Catatan UX

- Layout **mobile-first**, safe area, target sentuh besar
- Selector **Burn after** + teks bantuan singkat
- **Safety number** saat grup MLS siap — bandingkan di luar saluran
- **QR** berisi `https://<origin>/r/<KODE>`; kode bisa berotasi mid-session
- Identitas hanya di `sessionStorage`
- Gambar: selalu compress JPEG client, lalu chunk E2EE

### Env lokal (`apps/web/.env.local`)

```bash
# Opsional. Jika kosong, REST memakai rewrite same-origin /api/* → worker.
# NEXT_PUBLIC_API_URL=http://127.0.0.1:8787

# WebSocket harus absolute
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8787

# Target rewrite server-side (Next config)
# WORKER_URL=http://127.0.0.1:8787
```

Salin dari `apps/web/.env.example` bila perlu.

Gunakan **`127.0.0.1`**, bukan `localhost`, agar browser tidak ke IPv6 `::1`.

---

## CLI

```bash
# Buat room dan masuk sesi
pnpm --filter @ghostchat/cli start create
pnpm --filter @ghostchat/cli start create --max 6
pnpm --filter @ghostchat/cli start create --ttl on_leave

# Join room yang sudah ada
pnpm --filter @ghostchat/cli start join AB92KF
```

### Perintah dalam sesi

| Perintah | Fungsi |
|---|---|
| `/ttl on_read\|10s\|60s\|on_leave` | Mode burn pesan keluar |
| `/who` / `/status` | Status + safety number |
| `/safety` / `/fp` | Safety number saja |
| `/help` | Daftar perintah |
| `/quit` | Keluar room (memicu rotasi kode bagi yang tinggal) |

### Environment

| Variabel | Default |
|---|---|
| `GHOST_API_URL` | `http://127.0.0.1:8787` |
| `GHOST_WS_URL` | diturunkan dari API (`http` → `ws`) |
| `GHOST_WEB_URL` | `http://127.0.0.1:3000` |
| `NO_COLOR` | set untuk matikan warna ANSI |

---

## Worker / API

### REST

| Metode | Path | Deskripsi |
|---|---|---|
| `POST` | `/api/rooms` | Buat room → `{ roomId, wsUrl, maxParticipants }` |
| `GET` | `/api/rooms/:id` | Status: `ok` / `not_found` / full (+ `publicCode` / `internalId`) |
| `GET` | `/api/health` atau `/health` | Hidup `{ ok: true, service: "ghostchat-worker" }` |

### WebSocket

| Path | Deskripsi |
|---|---|
| `/ws/:roomId` | Upgrade; frame pertama `join`. Resolve alias undangan. |

### Batas (default di `@ghostchat/shared` `LIMITS`)

| Batas | Nilai |
|---|---|
| Max peserta / room | 2–20 (default 2) |
| Max pesan / koneksi / detik | 5 |
| Max gambar (tercompress) | 1 MB |
| Ukuran chunk gambar | ~24 KB (kirim ber-pace) |
| Max ciphertext (wire) | ~2.5 MB |
| Buat room / IP / menit | 10 |
| Probe join / IP / menit | 30 |
| Idle timeout | 10 menit |
| Usia maksimal room | 24 jam |
| Grace room kosong | 30 detik |

### Durable Object

- Kelas: `RoomDurableObject` (`apps/worker/src/room.ts`)
- Room DO: id **internal** stabil; invite publik bisa lewat alias DO (`a:KODE`)
- **Tidak** menyimpan isi pesan — hanya metadata / alarm pendek
- Sesi unik per `sessionToken` (aman reconnect / Strict Mode)
- Frame `leave` + tutup socket memutar invite jika masih ada peer

---

## Protokol

Versi wire major: **`v: 2`** (MLS). Tipe di `packages/protocol`.

**Client → server (contoh):**

```json
{ "v": 2, "type": "join", "displayId": "Anon-4XJ9", "publicKey": "mls", "sessionToken": "..." }
{ "v": 2, "type": "message", "ciphertext": "...", "nonce": "mls", "ttlMode": "60s", "messageId": "m_..." }
{ "v": 2, "type": "typing", "state": true }
{ "v": 2, "type": "burn", "messageId": "m_..." }
{ "v": 2, "type": "mls_key_package", "package": "..." }
{ "v": 2, "type": "mls_welcome", "to": "Anon-…", "welcome": "..." }
{ "v": 2, "type": "mls_commit", "commit": "..." }
{ "v": 2, "type": "leave" }
{ "v": 2, "type": "ping" }
```

**Server → client (contoh):**

```json
{ "v": 2, "type": "joined", "yourId": "Anon-4XJ9", "sessionToken": "...", "peers": [], "internalId": "…", "publicCode": "…" }
{ "v": 2, "type": "peer_joined", "peerId": "Anon-7QW2", "participantCount": 2 }
{ "v": 2, "type": "peer_left", "peerId": "Anon-7QW2", "participantCount": 1, "publicCode": "NEWID1" }
{ "v": 2, "type": "room_code", "publicCode": "NEWID1" }
{ "v": 2, "type": "message", "from": "Anon-7QW2", "ciphertext": "...", "nonce": "mls", "ttlMode": "60s", "messageId": "m_..." }
{ "v": 2, "type": "error", "code": "room_full" }
{ "v": 2, "type": "room_closed", "reason": "idle_timeout" }
```

Plaintext aplikasi bisa teks biasa, atau payload terstruktur (`GCIMG1` / `GCIMGC1` gambar, `GCEMO1` emoji) di `@ghostchat/shared`.

---

## Kriptografi

| Langkah | Algoritma | Library |
|---|---|---|
| Group E2EE | **MLS (RFC 9420)** | `ts-mls` |
| Ciphersuite | `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` | `ts-mls` / HPKE |
| Safety number | SHA-256 `confirmedTranscriptHash` | `@noble/hashes` |
| Protocol | `PROTOCOL_VERSION = 2` | `@ghostchat/protocol` |

**Aturan:**

- Kunci privat & state MLS hanya di memori proses / tab
- Server hanya melihat ciphertext MLS + metadata kehadiran
- Safety number **terikat epoch** — bandingkan ulang setelah join/leave
- `ts-mls` belum diaudit formal

### Apa itu “Burn after”?

Berapa lama pesan tampil di UI sebelum dihapus. Kontrak **antar client** — server tidak menyimpan pesan.

| Mode | Arti |
|---|---|
| After read (`on_read`) | Hilang sebentar setelah penerima melihat |
| 10 seconds | Hilang ~10 detik |
| 60 seconds | Hilang ~60 detik |
| When I leave (`on_leave`) | Tidak timer — hangus saat **pengirim** keluar |

---

## Model keamanan

### Dilindungi

- Penyadap / operator server tidak membaca plaintext
- Tidak ada store pesan awet setelah room musnah
- Tidak ada graf akun ke email/telepon
- Anggota yang keluar tidak bisa join lagi dengan undangan lama setelah rotasi

### Tidak dilindungi

- Endpoint terkompromi (malware, screen capture)
- Siapa pun yang tahu **kode room saat ini** bisa join (jika masih ada slot)
- MITM jika kanal undangan bermusuhan — mitigasi: **safety number**
- Konten ilegal — server tidak memoderasi ciphertext

### Mitigasi operasional

- Rate limit create/join
- Umur room pendek
- Rotasi undangan saat leave
- Perbandingan safety number opsional

---

## Konfigurasi

### Worker (`apps/worker/wrangler.toml`)

| Binding / var | Fungsi |
|---|---|
| `ROOMS` | Namespace Durable Object |
| `PUBLIC_WS_ORIGIN` | `wsUrl` hasil create (mis. `wss://….workers.dev`) |

Dev lokal listen di `0.0.0.0:8787`.

### Web

| Variabel | Fungsi |
|---|---|
| `NEXT_PUBLIC_API_URL` | Origin REST absolute (opsional) |
| `NEXT_PUBLIC_WS_URL` | Origin WebSocket absolute |
| `WORKER_URL` | Target rewrite server untuk `/api/*` |

---

## Skrip

| Skrip | Deskripsi |
|---|---|
| `pnpm install` | Instal semua workspace |
| `pnpm build:packages` | Build `shared`, `protocol`, `crypto` |
| `pnpm build` | Packages + build produksi Next |
| `pnpm dev:worker` | Worker lokal Wrangler |
| `pnpm dev:web` | Next dev (port 3000) |
| `pnpm dev:cli` | Entry CLI |
| `pnpm typecheck` | Typecheck semua package |
| `pnpm test` | Unit test |
| `pnpm audit:local` | typecheck + test + build web |
| `pnpm clean` | Hapus artefak build |

---

## Pengujian

```bash
pnpm test
```

| Package | Cakupan |
|---|---|
| `@ghostchat/crypto` | MLS 2-/3-party join + pesan + remove; helper AEAD legacy |
| `@ghostchat/shared` | ID room, TTL, payload gambar/emoji, **reassembly chunk** |
| `@ghostchat/worker` | Rate limiter sliding window |

Ide uji manual:

1. Web create (max 3) → dua klien join → chat  
2. Satu peer leave → yang tinggal melihat **kode baru**; kode lama gagal join  
3. Kirim gambar tercompress → peer menerima preview  
4. Bandingkan safety number setelah join  
5. Refresh satu tab — reconnect tanpa `room full` palsu  

---

## Deploy

### Worker (Cloudflare)

```bash
cd apps/worker
# set PUBLIC_WS_ORIGIN=wss://worker-anda.subdomain.workers.dev
pnpm deploy
```

Memerlukan plan Workers dengan **Durable Objects**.

### Web (mis. Vercel)

1. Root monorepo sebagai project  
2. Build: `pnpm build`  
3. Env:
   - `NEXT_PUBLIC_WS_URL=wss://worker-anda…`
   - `WORKER_URL=https://worker-anda…` (rewrite `/api/*`)
   - opsional `NEXT_PUBLIC_API_URL=https://worker-anda…`

Probe health: same-origin `/api/health` → rewrite → worker `/api/health` (juga menerima `/health`).

---

## Pemecahan masalah

| Gejala | Kemungkinan | Perbaikan |
|---|---|---|
| “relay offline” (lokal) | Worker tidak jalan | `pnpm dev:worker` |
| “relay offline” (prod) | `WORKER_URL` salah | Arahkan ke origin worker; cek `/api/health` |
| Error WebSocket | Host salah / IPv6 | Lokal: `127.0.0.1`; prod: `wss://` |
| Stuck waiting peer | Room full / double session | Satu tab per peer; hard refresh |
| Kode tidak berubah saat leave | Worker belum di-redeploy | Redeploy worker (leave + rotate) |
| Gambar gagal | Terlalu besar / MLS belum siap | Max **1MB** setelah compress |
| Room not found | Kedaluwarsa / sudah dirotasi | Pakai **kode share terkini** |
| Rate limited | Terlalu banyak create/join | Tunggu ~1 menit |
| CLI tidak connect | Worker down / env salah | Cek `GHOST_API_URL` / `GHOST_WS_URL` |

---

## Roadmap

- Multi-env deploy  
- PWA  
- Grace reconnect lebih lama  
- Passphrase room opsional  
- Scanner QR in-app  
- PQ MLS (X-Wing / ML-KEM)

Di luar cakupan: akun, riwayat cloud, push, moderasi plaintext di server.

---

## Lisensi

Privat / belum ditentukan kecuali Anda menambahkan file lisensi.

---

**GhostChat** — ngobrol sekali. Tidak menyisakan apa pun.
