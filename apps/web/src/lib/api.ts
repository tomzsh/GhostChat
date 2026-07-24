import type { CreateRoomResponse, RoomStatusResponse } from "@ghostchat/protocol";
import { getApiBase, getHealthUrl, isLocalDevUi } from "./config";

function apiUrl(path: string): string {
  const base = getApiBase();
  return `${base}${path}`;
}

function relayUnreachableMessage(): string {
  return isLocalDevUi()
    ? "Relay unreachable — run pnpm dev:worker"
    : "Relay unreachable — try again in a moment";
}

export async function createRoom(options?: {
  maxParticipants?: number;
}): Promise<CreateRoomResponse> {
  const res = await fetch(apiUrl("/api/rooms"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maxParticipants: options?.maxParticipants,
    }),
  });
  if (res.status === 429) {
    throw new Error("Too many rooms created — try again in a minute");
  }
  if (!res.ok) {
    throw new Error(
      res.status === 0 || res.type === "error"
        ? relayUnreachableMessage()
        : `Failed to create room (${res.status})`
    );
  }
  return res.json() as Promise<CreateRoomResponse>;
}

export async function getRoomStatus(
  roomId: string
): Promise<RoomStatusResponse> {
  const res = await fetch(apiUrl(`/api/rooms/${roomId}`));
  if (res.status === 404) {
    return { status: "not_found" };
  }
  if (res.status === 429) {
    throw new Error("Too many join attempts — try again in a minute");
  }
  if (!res.ok) {
    throw new Error(`Failed to check room (${res.status})`);
  }
  return res.json() as Promise<RoomStatusResponse>;
}

function abortAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function probeHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      // Don't hang the landing UI if relay is slow
      signal: abortAfter(6_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; service?: string };
    return body.ok === true;
  } catch {
    return false;
  }
}

/**
 * Quick relay health probe for the landing page.
 * Tries canonical path first, then legacy /health for older worker deploys.
 */
export async function checkRelayHealth(): Promise<boolean> {
  const primary = getHealthUrl();
  if (await probeHealth(primary)) return true;

  // Fallback: same host with the alternate path
  try {
    const u = new URL(
      primary,
      typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1"
    );
    if (u.pathname.endsWith("/api/health")) {
      u.pathname = u.pathname.replace(/\/api\/health$/, "/health");
    } else if (u.pathname.endsWith("/health")) {
      u.pathname = u.pathname.replace(/\/health$/, "/api/health");
    } else {
      return false;
    }
    return probeHealth(u.toString());
  } catch {
    return false;
  }
}
