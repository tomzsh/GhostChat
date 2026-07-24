import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, "../..");

const workerOrigin = (
  process.env.WORKER_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8787"
).replace(/\/$/, "");

const wsOrigin = (
  process.env.NEXT_PUBLIC_WS_URL ||
  process.env.NEXT_PUBLIC_API_URL?.replace(/^http/i, "ws") ||
  "ws://127.0.0.1:8787"
).replace(/\/$/, "");

/** Browser connect targets: same-origin REST + absolute WS (and wss twin). */
const cspConnectSrc = [
  "'self'",
  workerOrigin,
  wsOrigin,
  wsOrigin.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:"),
  wsOrigin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:"),
]
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i)
  .join(" ");

const securityHeaders: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js needs inline for hydration / font CSS in some builds
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${cspConnectSrc}`,
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  // HSTS is also set by Vercel; keep explicit for non-Vercel hosts
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  transpilePackages: [
    "@ghostchat/crypto",
    "@ghostchat/protocol",
    "@ghostchat/shared",
  ],

  // Keep tracing inside this monorepo so Next does not pick up sibling apps'
  // node_modules (prevents mixed Next 14/15 webpack module graphs).
  outputFileTracingRoot: monorepoRoot,

  // Dev: allow both localhost and 127.0.0.1 without cross-origin chunk warnings
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Hide X-Powered-By
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

  // Proxy REST to the worker so the browser can call /api/* same-origin.
  // WebSocket still connects to the worker host directly (see getWsUrl).
  async rewrites() {
    // Prefer /api/health (current worker). Also rewrite legacy path if clients call it.
    return [
      {
        source: "/api/health",
        destination: `${workerOrigin}/api/health`,
      },
      {
        source: "/health",
        destination: `${workerOrigin}/health`,
      },
      {
        source: "/api/rooms",
        destination: `${workerOrigin}/api/rooms`,
      },
      {
        source: "/api/rooms/:id",
        destination: `${workerOrigin}/api/rooms/:id`,
      },
    ];
  },
};

export default nextConfig;
