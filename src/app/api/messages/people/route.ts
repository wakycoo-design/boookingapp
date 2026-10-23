import { app } from "@/features/container";
import { permissionKey } from "@/features/access/access.dto";
import { chatRoute } from "@/lib/chat-route";

export const dynamic = "force-dynamic";

/** GET: who can be messaged or mentioned, and (for those who may message whole roles) the roles. */
export const GET = chatRoute(async (_req, me) => {
  const staff = (await app().staff.list()).filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));
  const roles = me.permissions.has(permissionKey("messages.announcements", "add")) ? (await app().access.roles()).map((r) => ({ id: r.id, name: r.name })) : [];
  return { staff, roles };
});
