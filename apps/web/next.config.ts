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

  // Proxy REST to the worker so the browser can call /api/* same-origin.
  // WebSocket still connects to the worker host directly (see getWsUrl).
  async rewrites() {
    return [
      {
        source: "/api/health",
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
