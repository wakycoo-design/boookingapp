"use server";

import { revalidatePath } from "next/cache";
import { app } from "@/features/container";
import { isDomainError, isUpstreamError } from "@/features/shared/errors";
import { requirePermission } from "@/lib/session";

export type WaReplyState = { error: string | null; sentAt: number | null };

export async function replyAction(clientId: string, _prev: WaReplyState, form: FormData): Promise<WaReplyState> {
  const me = await requirePermission("whatsapp", "add");
  try {
    await app().whatsappInbox.reply(me.id, clientId, String(form.get("body") ?? ""));
  } catch (err) {
    if (isDomainError(err) || isUpstreamError(err)) return { error: err.message, sentAt: null };
    throw err;
  }
  revalidatePath(`/admin/messages/whatsapp/${clientId}`);
  return { error: null, sentAt: Date.now() };
}
