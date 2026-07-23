import {
  generateRoomId,
  isValidRoomId,
  normalizeRoomId,
  LIMITS,
  clampMaxParticipants,
} from "@ghostchat/shared";
import { RoomDurableObject } from "./room";
import { SlidingWindowLimiter, clientIp } from "./rateLimit";

export { RoomDurableObject };

export interface Env {
  ROOMS: DurableObjectNamespace;
  PUBLIC_WS_ORIGIN: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const createLimiter = new SlidingWindowLimiter(
  LIMITS.maxCreatesPerMinute,
  LIMITS.rateLimitWindowMs
);
const joinLimiter = new SlidingWindowLimiter(
  LIMITS.maxJoinProbesPerMinute,
  LIMITS.rateLimitWindowMs
);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function rateLimited(): Response {
  return json({ error: "rate_limited", code: "rate_limited" }, 429);
}

function getRoomStub(env: Env, roomId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const ip = clientIp(request);

    if (path === "/api/rooms" && request.method === "POST") {
      if (!createLimiter.allow(`create:${ip}`)) return rateLimited();

      let maxParticipants: number = LIMITS.defaultMaxParticipants;
      try {
        const body = (await request.json()) as { maxParticipants?: unknown };
        if (body && body.maxParticipants !== undefined) {
          maxParticipants = clampMaxParticipants(body.maxParticipants);
        }
      } catch {
        /* empty body OK */
      }

      const roomId = generateRoomId();
      const stub = getRoomStub(env, roomId);
      await stub.fetch("https://do/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, maxParticipants }),
      });

      const host = url.host;
      const wsOrigin =
        env.PUBLIC_WS_ORIGIN ||
        `${url.protocol === "https:" ? "wss" : "ws"}://${host}`;

      return json({
        roomId,
        wsUrl: `${wsOrigin.replace(/\/$/, "")}/ws/${roomId}`,
        maxParticipants,
      });
    }

    const statusMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)$/);
    if (statusMatch && request.method === "GET") {
      if (!joinLimiter.allow(`join:${ip}`)) return rateLimited();

      const roomId = normalizeRoomId(statusMatch[1]!);
      if (!isValidRoomId(roomId)) {
        return json({ status: "not_found" }, 404);
      }
      const res = await getRoomStub(env, roomId).fetch("https://do/status");
      const body = await res.json();
      const status = (body as { status?: string }).status;
      return json(body, status === "not_found" ? 404 : 200);
    }

    const wsMatch = path.match(/^\/ws\/([A-Za-z0-9]+)$/);
    if (wsMatch) {
      if (!joinLimiter.allow(`join:${ip}`)) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }

      const roomId = normalizeRoomId(wsMatch[1]!);
      if (!isValidRoomId(roomId)) {
        return json({ error: "room_not_found" }, 404);
      }
      const stub = getRoomStub(env, roomId);
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    if (path === "/" || path === "/health") {
      return json({ ok: true, service: "ghostchat" });
    }

    return json({ error: "not_found" }, 404);
  },
};
