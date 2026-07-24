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
  /**
   * Optional documented public WS origin for operators.
   * Create API returns path-only `wsPath` — clients use their own WS config.
   */
  PUBLIC_WS_ORIGIN: string;
  /**
   * Comma-separated browser origins allowed for CORS.
   * Example: https://ghostchat-web-two.vercel.app,http://127.0.0.1:3000
   * Empty → built-in GhostChat hosts + localhost (not `*`).
   */
  ALLOWED_ORIGINS?: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Strict-Transport-Security":
    "max-age=63072000; includeSubDomains; preload",
};

const DEFAULT_ALLOWED_ORIGINS = [
  "https://ghostchat-web-two.vercel.app",
  "https://ghostchat-web-tomzsh1.vercel.app",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

const createLimiter = new SlidingWindowLimiter(
  LIMITS.maxCreatesPerMinute,
  LIMITS.rateLimitWindowMs
);
const joinLimiter = new SlidingWindowLimiter(
  LIMITS.maxJoinProbesPerMinute,
  LIMITS.rateLimitWindowMs
);

function allowedOriginList(env: Env): string[] {
  const raw = env.ALLOWED_ORIGINS?.trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin: string, env: Env): boolean {
  const list = allowedOriginList(env);
  if (list.includes("*")) return true;
  if (list.includes(origin)) return true;
  try {
    const u = new URL(origin);
    // Preview: https://ghostchat-*.vercel.app
    if (
      u.protocol === "https:" &&
      u.hostname.endsWith(".vercel.app") &&
      u.hostname.includes("ghostchat")
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  // CLI / server-to-server: no Origin
  if (!origin) return base;
  if (isOriginAllowed(origin, env)) {
    return {
      ...base,
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  }
  return base;
}

function json(
  data: unknown,
  status: number,
  request: Request,
  env: Env
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...corsHeaders(request, env),
    },
  });
}

function rateLimited(request: Request, env: Env): Response {
  return json(
    { error: "rate_limited", code: "rate_limited" },
    429,
    request,
    env
  );
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

/** Public invite probe — no internalId / live count leakage. */
type PublicStatusBody =
  | {
      status: "ok";
      roomId: string;
      maxParticipants: number;
      full: boolean;
    }
  | { status: "not_found" }
  | { status: "full"; roomId: string; maxParticipants?: number };

function toPublicStatus(body: StatusBody): PublicStatusBody {
  if (body.status === "ok") {
    return {
      status: "ok",
      roomId: body.roomId,
      maxParticipants: body.maxParticipants,
      full: body.full,
    };
  }
  if (body.status === "full") {
    return {
      status: "full",
      roomId: body.roomId,
      maxParticipants: body.maxParticipants,
    };
  }
  return { status: "not_found" };
}

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

async function resolveRoom(
  env: Env,
  code: string,
  mode: "invite" | "ws"
): Promise<{ body: StatusBody; status: number; internalId: string | null }> {
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
    if (
      mode === "invite" &&
      code === internalId &&
      publicCode !== internalId
    ) {
      return { body: { status: "not_found" }, status: 404, internalId: null };
    }
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
        headers: { ...SECURITY_HEADERS, ...corsHeaders(request, env) },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const ip = clientIp(request);

    if (path === "/api/rooms" && request.method === "POST") {
      if (!createLimiter.allow(`create:${ip}`)) {
        return rateLimited(request, env);
      }

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

      // Path only — clients prefix with their configured WS origin (no infra leak)
      return json(
        {
          roomId,
          maxParticipants,
          wsPath: `/ws/${roomId}`,
        },
        200,
        request,
        env
      );
    }

    const statusMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)$/);
    if (statusMatch && request.method === "GET") {
      if (!joinLimiter.allow(`join:${ip}`)) {
        return rateLimited(request, env);
      }

      const roomId = normalizeRoomId(statusMatch[1]!);
      if (!isValidRoomId(roomId)) {
        return json({ status: "not_found" }, 404, request, env);
      }
      const { body, status } = await resolveRoom(env, roomId, "invite");
      return json(toPublicStatus(body), status, request, env);
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
            ...corsHeaders(request, env),
          },
        });
      }

      const roomId = normalizeRoomId(wsMatch[1]!);
      if (!isValidRoomId(roomId)) {
        return json({ error: "room_not_found" }, 404, request, env);
      }

      const resolved = await resolveRoom(env, roomId, "ws");
      if (!resolved.internalId || resolved.body.status === "not_found") {
        return json({ error: "room_not_found" }, 404, request, env);
      }

      const stub = getRoomStub(env, resolved.internalId);
      const doUrl = new URL(request.url);
      doUrl.pathname = "/ws";
      return stub.fetch(doUrl.toString(), request);
    }

    if (
      (path === "/api/health" || path === "/health") &&
      request.method === "GET"
    ) {
      return json(
        { ok: true, service: "ghostchat-worker" },
        200,
        request,
        env
      );
    }

    return json({ error: "not_found" }, 404, request, env);
  },
};
