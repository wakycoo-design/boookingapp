import { app } from "@/features/container";
import { isDomainError, isUpstreamError } from "@/features/shared/errors";
import { apiError } from "@/lib/api";

export const dynamic = "force-dynamic";

const STATUS = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409 } as const;

function fail(err: unknown) {
  if (isDomainError(err)) return apiError(STATUS[err.code], err.code, err.message);
  if (isUpstreamError(err)) return apiError(err.status, err.code, err.message);
  throw err;
}

/**
 * The callback URL to paste into Meta (WhatsApp > Configuration). One URL serves every subscribed field: incoming
 * messages, delivery statuses and template reviews all arrive here and are told apart by their `field`.
 */
export async function GET(req: Request) {
  try {
    const challenge = app().webhooks.verifySubscription(new URL(req.url).searchParams);
    // Meta expects the challenge back as the bare body, not JSON.
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    // The signature covers the exact bytes Meta sent, so read the body as text before anything parses it.
    const received = await app().webhooks.receive(await req.text(), req.headers.get("x-hub-signature-256"));
    return Response.json({ data: { received } });
  } catch (err) {
    return fail(err);
  }
}
