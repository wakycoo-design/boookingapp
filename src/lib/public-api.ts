import { NextResponse, type NextRequest } from "next/server";
import { ApiResult, apiError, errorResponse } from "@/lib/api";
import { callerKey, rateLimit } from "@/lib/rate-limit";

type Handler = (req: NextRequest) => Promise<unknown>;

/**
 * Sites allowed to call /api/public/v1 from the browser, from PUBLIC_API_ORIGINS (comma-separated).
 * Unset means the public API is off: a static website can't keep an API key secret, so this is opt-in.
 */
export function publicOrigins(env: Record<string, string | undefined> = process.env): string[] {
  return (env.PUBLIC_API_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** The allowed origin of this request, or null when the public API is off or the caller isn't on the list. */
function allowedOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  return origin && publicOrigins().includes(origin) ? origin : null;
}

/** Answers the browser's CORS preflight. */
export function publicPreflight(req: NextRequest) {
  const origin = allowedOrigin(req);
  if (!origin) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

/**
 * Wraps a keyless /api/public/v1 handler for the firm's own website. It acts exactly like the public /book page:
 * client rules only, and a per-visitor limit (`max` calls per `windowMs`) instead of an API key.
 */
export function publicRoute(name: string, max: number, windowMs: number, handler: Handler) {
  return async (req: NextRequest) => {
    const origin = allowedOrigin(req);
    if (!origin) return apiError(403, "forbidden", "This site may not call the booking API");
    const cors = corsHeaders(origin);
    // Keyed by a hash of the visitor's address, so one visitor can't flood the diary or the slot engine.
    const limit = rateLimit(`public:${name}:${callerKey(req.headers)}`, max, windowMs);
    if (!limit.ok) {
      const res = apiError(429, "rate_limited", `Too many requests. Try again in ${limit.retryAfterSec} seconds.`);
      res.headers.set("Retry-After", String(limit.retryAfterSec));
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }
    let res: NextResponse;
    try {
      const result = await handler(req);
      res =
        result instanceof ApiResult
          ? NextResponse.json({ data: result.data }, { status: result.status, headers: result.headers })
          : NextResponse.json({ data: result });
    } catch (err) {
      res = errorResponse(err);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  };
}
