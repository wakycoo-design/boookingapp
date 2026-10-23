import { app } from "@/features/container";
import { chatRoute } from "@/lib/chat-route";

export const dynamic = "force-dynamic";

/** PATCH { body }: edit my message. */
export const PATCH = chatRoute<{ messageId: string }>(async (req, me, { messageId }) => {
  const { body } = (await req.json().catch(() => ({}))) as { body?: string };
  await app().messages.edit(me, messageId, String(body ?? ""));
  return { ok: true };
});

/** DELETE: delete my message (or anyone's, with Delete others' messages). */
export const DELETE = chatRoute<{ messageId: string }>(async (_req, me, { messageId }) => {
  await app().messages.remove(me, messageId);
  return { ok: true };
});
