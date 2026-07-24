/**
 * REST: same-origin `/api/*` rewrites in the browser (no worker host needed).
 * WebSocket: requires `NEXT_PUBLIC_WS_URL` in production so localhost is not
 * used as a silent fallback.
 */

function envApi(): string | undefined {
  const v = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  return v || undefined;
}

function envWs(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const api = envApi();
  if (api) return api.replace(/^http/i, "ws");
  return undefined;
}

/**
 * Worker HTTP origin for REST.
 * Empty string = same origin (Next.js rewrites → worker).
 */
export function getApiBase(): string {
  if (envApi()) return envApi()!;
  // Browser: prefer same-origin rewrites when available
  if (typeof window !== "undefined") return "";
  // Node SSR / scripts in development only
  if (process.env.NODE_ENV !== "production") {
    return "http://127.0.0.1:8787";
  }
  return "";
}

/** WebSocket URL for a room (always absolute). */
export function getWsUrl(roomId: string): string {
  const configured = envWs();
  if (configured) {
    return `${configured}/ws/${roomId}`;
  }
  // Dev-only fallback — tree-shaken / unused when NEXT_PUBLIC_WS_URL is set
  if (process.env.NODE_ENV !== "production") {
    return `ws://127.0.0.1:8787/ws/${roomId}`;
  }
  throw new Error(
    "NEXT_PUBLIC_WS_URL is not set — configure the WebSocket relay origin"
  );
}

/** Health check URL (REST) — same-origin rewrite or absolute worker API. */
export function getHealthUrl(): string {
  const base = getApiBase();
  return base ? `${base}/api/health` : "/api/health";
}

/** True when running a local/dev build (not production hosting). */
export function isLocalDevUi(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}
