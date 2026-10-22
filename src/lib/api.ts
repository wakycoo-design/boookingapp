import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { app } from "@/features/container";
import type { ApiKeyDTO, ApiScope } from "@/features/api-keys/api-keys.dto";
import { DomainError, isDomainError, isUpstreamError } from "@/features/shared/errors";
import { rateLimit } from "@/lib/rate-limit";

type RouteContext = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: { key: ApiKeyDTO; params: Record<string, string> }) => Promise<unknown>;

/** Return this from a handler to choose the status code or add headers. */
export class ApiResult {
  constructor(
    public readonly data: unknown,
    public readonly status = 200,
    public readonly headers: Record<string, string> = {},
  ) {}
}

/** Who a key acts for: a "website" key acts for the client (website rules); a "staff" key acts as staff. */
export const keyActor = (key: ApiKeyDTO) => ({
  apiKeyId: key.id,
  mode: key.scopes.includes("staff") ? ("staff" as const) : ("client" as const),
});

/** Reads a JSON body; an empty or broken body is a 400, not a 500. */
export async function jsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new DomainError("invalid", "Request body must be JSON");
  }
}

/** Per API key. Generous for a busy website; far below what would strain the server. */
export const API_LIMIT_PER_MINUTE = 600;

const STATUS: Record<DomainError["code"], number> = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409 };

export function apiError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

function readKey(req: NextRequest) {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return req.headers.get("x-api-key");
}

/**
 * Wraps a /api/v1 handler: checks the API key and scope, returns `{ data }` on success
 * and `{ error }` with the right status otherwise. A "staff" key may call website endpoints too.
 */
export function apiRoute(scope: ApiScope, handler: Handler) {
  return async (req: NextRequest, route?: RouteContext) => {
    try {
      const key = await app().apiKeys.verify(readKey(req));
      if (!key) return apiError(401, "unauthorized", "Missing or invalid API key");
      if (!key.scopes.includes(scope) && !key.scopes.includes("staff")) {
        return apiError(403, "forbidden", "This API key cannot call this endpoint");
      }
      // A runaway script or a leaked key shouldn't be able to hammer the booking engine.
      const limit = rateLimit(`api:${key.id}`, API_LIMIT_PER_MINUTE, 60_000);
      if (!limit.ok) {
        return NextResponse.json(
          { error: { code: "rate_limited", message: `Too many requests. Try again in ${limit.retryAfterSec} seconds.` } },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
        );
      }
      const result = await handler(req, { key, params: (await route?.params) ?? {} });
      if (result instanceof ApiResult) {
        return NextResponse.json({ data: result.data }, { status: result.status, headers: result.headers });
      }
      return NextResponse.json({ data: result });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Maps a thrown error to the `{ error }` response every API route answers with. */
export function errorResponse(err: unknown) {
  if (err instanceof ZodError) return apiError(400, "invalid", "Invalid request", err.issues);
  if (isDomainError(err)) return apiError(STATUS[err.code], err.code, err.message, err.details);
  if (isUpstreamError(err)) return apiError(err.status, err.code === "not_configured" ? "not_configured" : "delivery_failed", err.message);
  console.error(err);
  return apiError(500, "internal", "Something went wrong");
}
