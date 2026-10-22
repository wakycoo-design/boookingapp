import { app } from "@/features/container";
import { hasPrice } from "@/features/catalog/catalog.dto";
import { toPublicBooking } from "@/features/bookings/bookings.dto";
import { DomainError } from "@/features/shared/errors";
import { ApiResult, jsonBody } from "@/lib/api";
import { publicPreflight, publicRoute } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/v1/bookings  (Idempotency-Key header, or `idempotencyKey` in the body)
 * { serviceId, staffId?, start, client: { name, phone, email?, whatsappOptIn? }, notes?, formAnswers?, idempotencyKey? }
 * The key may come in the body so a browser can send a plain-text POST with no preflight: Catalyst's gateway answers
 * OPTIONS itself without CORS headers, so a preflighted request never reaches this route.
 * Books like the public /book page: client rules, pay later. No package purchase here, because that needs a payment.
 * 201 with the booking and `manageUrl` (where the client can move or cancel it); 200 on a retry with the same key.
 */
export const POST = publicRoute("book", 8, 10 * 60_000, async (req) => {
  const { bookings, catalog, settings } = app();
  const body = (await jsonBody(req)) as { purchase?: unknown } & Record<string, unknown>;
  if (body.purchase) throw new DomainError("invalid", "Packages can't be bought through the public API");
  // Same rule as /book: with online payment on, a priced booking would expire unpaid, so it must go through the keyed API.
  const svc = await catalog.get(String(body.serviceId ?? ""));
  const { onlinePayment, bookingPrefix } = await settings.get();
  if (onlinePayment && hasPrice(svc) && svc.pricePaise !== null) {
    throw new DomainError("forbidden", "This service is paid for online and can't be booked here");
  }
  const idempotencyKey = req.headers.get("idempotency-key") ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null);
  const result = await bookings.create({ mode: "client" }, body, { idempotencyKey });
  const base = (process.env.AUTH_URL || req.nextUrl.origin).replace(/\/$/, "");
  return new ApiResult(
    {
      booking: toPublicBooking(result.booking, bookingPrefix),
      manageUrl: `${base}/manage/${result.booking.id}?t=${result.manageToken}`,
    },
    result.replayed ? 200 : 201,
    result.replayed ? { "Idempotent-Replayed": "true" } : {},
  );
});

export const OPTIONS = publicPreflight;
