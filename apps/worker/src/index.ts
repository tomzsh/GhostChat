import {
  generateRoomId,
  isValidRoomId,
  normalizeRoomId,
  LIMITS,
  clampMaxParticipants,
} from "@ghostchat/shared";
import { RoomDurableObject, type RoomEnv } from "./room";
import { SlidingWindowLimiter, clientIp } from "./rateLimit";

export { RoomDurableObject };

export interface Env extends RoomEnv {
  PUBLIC_WS_ORIGIN: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Baseline security headers for Worker JSON / OPTIONS responses. */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Resource-Policy": "cross-origin",
  // Workers are always HTTPS on *.workers.dev
  "Strict-Transport-Security":
    "max-age=63072000; includeSubDomains; preload",
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
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...CORS_HEADERS,
    },
  });
}

function rateLimited(): Response {
  return json({ error: "rate_limited", code: "rate_limited" }, 429);
}

/** Prefer env PUBLIC_WS_ORIGIN, but ignore localhost/127.0.0.1 on public hosts. */
function resolvePublicWsOrigin(request: Request, env: Env): string {
  const url = new URL(request.url);
  const fromRequest = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}`;
  const configured = (env.PUBLIC_WS_ORIGIN || "").replace(/\/$/, "").trim();
  if (!configured) return fromRequest;
  // Deployed worker with leftover local wrangler var — use request host instead
  if (/127\.0\.0\.1|localhost/i.test(configured) && url.hostname !== "127.0.0.1") {
    return fromRequest;
  }
  // Force wss when client hit us over https
  if (url.protocol === "https:" && configured.startsWith("ws://")) {
    return configured.replace(/^ws:\/\//i, "wss://");
  }
  return configured;
}

function getRoomStub(env: Env, roomId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

type StatusBody =
  | {
      status: "ok";
      roomId: string;
      internalId?: string;
      participantCount: number;
      maxParticipants: number;
      full: boolean;
    }
  | { status: "alias"; targetRoomId: string }
  | { status: "not_found" }
  | { status: "full"; roomId: string; maxParticipants?: number };

/** Prefixed alias DO name (must match room.ts). */
function aliasDoName(publicCode: string): string {
  return `a:${publicCode}`;
}

async function followAlias(
  env: Env,
  target: string
): Promise<{ body: StatusBody; status: number; internalId: string | null }> {
  const second = await getRoomStub(env, target).fetch("https://do/status");
  const inner = (await second.json()) as StatusBody;
  if (inner.status !== "ok") {
    return { body: { status: "not_found" }, status: 404, internalId: null };
  }
  return {
    body: {
      ...inner,
      roomId: inner.roomId,
      internalId: inner.internalId ?? target,
    },
    status: 200,
    internalId: inner.internalId ?? target,
  };
}

/**
 * Resolve invite / internal code → live room.
 * - Prefixed aliases `a:CODE` (current) + legacy unprefixed alias DOs
 * - `invite`: after rotation, bare internal id is NOT a valid share code
 * - `ws`: allow internal id so existing sockets/reconnects keep working
 */
async function resolveRoom(
  env: Env,
  code: string,
  mode: "invite" | "ws"
): Promise<{ body: StatusBody; status: number; internalId: string | null }> {
  // 1) Prefixed invite alias (post-rotation codes)
  try {
    const pref = await getRoomStub(env, aliasDoName(code)).fetch(
      "https://do/status"
    );
    const prefBody = (await pref.json()) as StatusBody;
    if (prefBody.status === "alias") {
      return followAlias(env, prefBody.targetRoomId);
    }
  } catch {
    /* fall through */
  }

  // 2) Direct DO name (live room or legacy unprefixed alias)
  const first = await getRoomStub(env, code).fetch("https://do/status");
  const body = (await first.json()) as StatusBody;

  if (body.status === "alias") {
    return followAlias(env, body.targetRoomId);
  }

  if (body.status === "not_found") {
    return { body, status: 404, internalId: null };
  }

  if (body.status === "ok") {
    const internalId = body.internalId ?? code;
    const publicCode = body.roomId;
    // Stale internal-as-invite after rotation (share/QR must use publicCode)
    if (
      mode === "invite" &&
      code === internalId &&
      publicCode !== internalId
    ) {
      return { body: { status: "not_found" }, status: 404, internalId: null };
    }
    // Unknown code that somehow hit a room DO
    if (code !== publicCode && code !== internalId) {
      return { body: { status: "not_found" }, status: 404, internalId: null };
    }
    return {
      body: { ...body, internalId },
      status: 200,
      internalId,
    };
  }

  return { body, status: 200, internalId: null };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...SECURITY_HEADERS, ...CORS_HEADERS },
      });
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

      // Never advertise loopback in production (wrangler.toml often has local default)
      const wsOrigin = resolvePublicWsOrigin(request, env);

      return json({
        roomId,
        wsUrl: `${wsOrigin}/ws/${roomId}`,
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
      const { body, status } = await resolveRoom(env, roomId, "invite");
      return json(body, status);
    }

    const wsMatch = path.match(/^\/ws\/([A-Za-z0-9]+)$/);
    if (wsMatch) {
      if (!joinLimiter.allow(`join:${ip}`)) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...SECURITY_HEADERS,
            ...CORS_HEADERS,
          },
        });
      }

      const roomId = normalizeRoomId(wsMatch[1]!);
      if (!isValidRoomId(roomId)) {
        return json({ error: "room_not_found" }, 404);
      }

      // Resolve alias / rotated codes to stable internal DO (allow internal id)
      const resolved = await resolveRoom(env, roomId, "ws");
      if (!resolved.internalId || resolved.body.status === "not_found") {
        return json({ error: "room_not_found" }, 404);
      }

      const stub = getRoomStub(env, resolved.internalId);
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";
      return stub.fetch(doUrl.toString(), request);
    }

    // Both paths: Next rewrites historically used /health; clients may call /api/health
    if (
      (path === "/api/health" || path === "/health") &&
      request.method === "GET"
    ) {
      return json({ ok: true, service: "ghostchat-worker" });
    }

    return json({ error: "not_found" }, 404);
  },
};
