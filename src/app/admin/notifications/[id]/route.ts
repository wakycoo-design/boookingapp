import { app } from "@/features/container";
import { currentStaff } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Opening a notification marks it read and goes where it points (the booking, the person, the client). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentStaff();
  if (!me) return Response.redirect(new URL("/login", request.url), 302);
  const { id } = await params;
  const href = await app().inbox.open(me.id, id).catch(() => null);
  // Only paths inside the app, so a stored link can never send anyone elsewhere.
  const target = href && href.startsWith("/") && !href.startsWith("//") ? href : "/admin/notifications";
  return Response.redirect(new URL(target, request.url), 302);
}
