/**
 * Local defaults use 127.0.0.1 (not "localhost") to avoid IPv6 (::1) mismatch
 * when wrangler binds IPv4 only.
 *
 * REST can go same-origin via Next rewrites when NEXT_PUBLIC_API_URL is unset.
 * WebSocket still talks to the worker directly (browsers need explicit WS URL).
 */
const LOCAL_API = "http://127.0.0.1:8787";
const LOCAL_WS = "ws://127.0.0.1:8787";

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
  return LOCAL_API;
}

/** WebSocket URL for a room (always absolute). */
export function getWsUrl(roomId: string): string {
  const base = envWs() ?? LOCAL_WS;
  return `${base}/ws/${roomId}`;
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
