export const dynamic = "force-dynamic";

/**
 * The cheapest possible answer from the server, for the connection banner to tell "the network is back" from "the
 * browser thinks it's online". It never touches the database, so a page polling it while offline costs nothing.
 */
export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export const HEAD = GET;
