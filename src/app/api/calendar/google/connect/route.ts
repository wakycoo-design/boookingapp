import { app } from "@/features/container";
import { isDomainError } from "@/features/shared/errors";
import { can, currentPermissions, currentStaff } from "@/lib/session";

export const dynamic = "force-dynamic";

function back(request: Request, staffId: string, key: "ok" | "error", message: string) {
  const base = process.env.AUTH_URL || new URL(request.url).origin;
  return Response.redirect(`${base.replace(/\/$/, "")}/admin/staff/${staffId}?${new URLSearchParams({ [key]: message })}`, 302);
}

/** Starts "Connect Google Calendar": sends the signed-in person (or a manager for them) to Google's consent screen. */
export async function GET(request: Request) {
  const me = await currentStaff();
  if (!me) return Response.redirect(new URL("/login", request.url), 302);
  const staffId = new URL(request.url).searchParams.get("staff") || me.id;
  const perms = await currentPermissions();
  if (!can(perms, "availability", "edit") || (staffId !== me.id && !can(perms, "availability", "viewAll"))) return Response.redirect(new URL("/?error=forbidden", request.url), 302);
  try {
    return Response.redirect(app().calendar.connectUrl(staffId), 302);
  } catch (err) {
    if (isDomainError(err)) return back(request, staffId, "error", err.message);
    throw err;
  }
}
