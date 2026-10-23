import { app } from "@/features/container";
import { DomainError } from "@/features/shared/errors";
import { chatRoute } from "@/lib/chat-route";

export const dynamic = "force-dynamic";

/**
 * GET ?after=<ISO>: the conversation and its messages (only newer ones with `after`), with who has seen each.
 * Opening it counts as reading it.
 */
export const GET = chatRoute<{ id: string }>(async (req, me, { id }) => {
  const after = new URL(req.url).searchParams.get("after");
  const since = after ? new Date(after) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new DomainError("invalid", "after must be a date");
  const [conversation, messages] = await Promise.all([app().messages.conversation(me, id), app().messages.messages(me, id, { after: since })]);
  await app().messages.markRead(me, id);
  return { conversation, messages };
});

/** POST (form data): body, clientId?, bookingId?, files. Sends a message. */
export const POST = chatRoute<{ id: string }>(async (req, me, { id }) => {
  const form = await req.formData().catch(() => {
    throw new DomainError("invalid", "Send the message as form data");
  });
  const files = await Promise.all(
    form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).map(async (f) => ({ fileName: f.name, contentType: f.type, data: Buffer.from(await f.arrayBuffer()) })),
  );
  const text = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : "");
  const messageId = await app().messages.send(me, id, { body: text("body"), clientId: text("clientId") || null, bookingId: text("bookingId") || null, files });
  return { id: messageId };
});
