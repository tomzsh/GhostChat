import type { CreateRoomResponse, RoomStatusResponse } from "@ghostchat/protocol";
import { getApiBase, getHealthUrl } from "./config";

function apiUrl(path: string): string {
  const base = getApiBase();
  return `${base}${path}`;
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
        ? "Relay unreachable — run pnpm dev:worker"
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

/** Quick relay health probe for the landing page. */
export async function checkRelayHealth(): Promise<boolean> {
  try {
    const res = await fetch(getHealthUrl(), {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}
