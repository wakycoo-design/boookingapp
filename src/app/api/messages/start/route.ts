import { app } from "@/features/container";
import { DomainError } from "@/features/shared/errors";
import { chatRoute } from "@/lib/chat-route";

export const dynamic = "force-dynamic";

/** POST { kind: "direct", staffId } | { kind: "group", title, memberIds } | { kind: "role", roleId }: start (or reopen) a conversation. */
export const POST = chatRoute(async (req, me) => {
  const b = (await req.json().catch(() => ({}))) as { kind?: string; staffId?: string; title?: string; memberIds?: string[]; roleId?: string };
  if (b.kind === "direct") return { id: await app().messages.startDirect(me, String(b.staffId ?? "")) };
  if (b.kind === "group") return { id: await app().messages.createGroup(me, { title: String(b.title ?? ""), memberIds: Array.isArray(b.memberIds) ? b.memberIds.map(String) : [] }) };
  if (b.kind === "role") return { id: await app().messages.roleConversation(me, String(b.roleId ?? "")) };
  throw new DomainError("invalid", "kind must be direct, group or role");
});
