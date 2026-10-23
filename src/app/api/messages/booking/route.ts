import { app } from "@/features/container";
import { permissionKey } from "@/features/access/access.dto";
import { bookingReference } from "@/features/bookings/bookings.dto";
import { DomainError } from "@/features/shared/errors";
import { chatRoute } from "@/lib/chat-route";

export const dynamic = "force-dynamic";

/** GET ?ref=WZ7801007: a booking to link in a message, if they may see it (their own, or everyone's). */
export const GET = chatRoute(async (req, me) => {
  if (!me.permissions.has(permissionKey("bookings", "view"))) throw new DomainError("forbidden", "Your role can't see bookings");
  const { bookingPrefix } = await app().settings.get();
  const b = await app().bookings.byReference(new URL(req.url).searchParams.get("ref") ?? "", bookingPrefix);
  if (!b || (b.staffId !== me.id && !me.permissions.has(permissionKey("bookings", "viewAll")))) throw new DomainError("not_found", "No booking with that ID that you can see");
  return { id: b.id, reference: bookingReference(bookingPrefix, b.number), clientName: b.clientName, startsAt: b.startsAt };
});
