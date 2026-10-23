import { app } from "@/features/container";
import { isDomainError } from "@/features/shared/errors";
import { can, currentPermissions, currentStaff } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Where Google sends people back after they approve (or refuse) access. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = (process.env.AUTH_URL || url.origin).replace(/\/$/, "");
  const go = (path: string, key: "ok" | "error", message: string) =>
    Response.redirect(`${base}${path}?${new URLSearchParams({ [key]: message })}`, 302);

  const me = await currentStaff();
  if (!me) return Response.redirect(`${base}/login`, 302);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  try {
    const owner = app().calendar.stateOwner(state);
    // The link is signed, but also make sure it is the person it was made for (or their manager) finishing it.
    const perms = await currentPermissions();
    if (!owner || !can(perms, "availability", "edit") || (owner !== me.id && !can(perms, "availability", "viewAll"))) {
      return go(`/admin/staff/${me.id}`, "error", "This connect link has expired or is not valid; start again");
    }
    if (url.searchParams.get("error") || !code) return go(`/admin/staff/${owner}`, "error", "Google Calendar was not connected: access was not granted");
    await app().calendar.completeConnect(code, state);
    return go(`/admin/staff/${owner}`, "ok", "Google Calendar connected");
  } catch (err) {
    if (isDomainError(err)) return go(`/admin/staff/${me.id}`, "error", err.message);
    throw err;
  }
}
