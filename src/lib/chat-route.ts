import { errorResponse, apiError } from "@/lib/api";
import { currentPermissions, currentStaff } from "@/lib/session";
import type { Chatter } from "@/features/messages/messages.service";

/** Wraps a team-messages JSON route: signed in, with their permissions; errors come back as { error }. */
export function chatRoute<P extends Record<string, string>>(handler: (req: Request, me: Chatter, params: P) => Promise<unknown>) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const member = await currentStaff();
      if (!member) return apiError(401, "unauthorized", "Sign in first");
      const me: Chatter = { id: member.id, name: member.name, roleId: member.roleId, permissions: await currentPermissions() };
      const result = await handler(req, me, await ctx.params);
      return result instanceof Response ? result : Response.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
