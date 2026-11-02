import { z } from "zod";
import { DomainError, isUpstreamError } from "@/features/shared/errors";
import type { ChatStatus, IncomingChat } from "@/features/webhooks/whatsapp";
import { REPLY_WINDOW_MS } from "./whatsapp-inbox.dto";
import type { createWhatsappInboxRepository } from "./whatsapp-inbox.repository";
import type { WaTextSender } from "./whatsapp-inbox.sender";

const replySchema = z.string().trim().min(1, "Write a message first").max(4096, "A WhatsApp message can be at most 4,096 characters");

export function createWhatsappInboxService(deps: { inboxRepo: ReturnType<typeof createWhatsappInboxRepository>; sendText: WaTextSender }) {
  const { inboxRepo } = deps;

  async function thread(clientId: string) {
    // A mistyped link must be a 404, not a database error about a malformed uuid.
    const c = z.string().uuid().safeParse(clientId).success ? await inboxRepo.client(clientId) : null;
    if (!c) throw new DomainError("not_found", `Client ${clientId} not found`);
    return c;
  }

  return {
    /** What a webhook delivery brought: new messages from clients and the fate of what we sent. */
    async receive({ messages, statuses }: { messages: IncomingChat[]; statuses: ChatStatus[] }) {
      for (const m of messages) {
        await inboxRepo.recordIncoming({ phoneE164: `+${m.from.replace(/\D/g, "")}`, profileName: m.profileName, waMessageId: m.waMessageId, kind: m.kind, body: m.body, at: m.at });
      }
      for (const s of statuses) await inboxRepo.updateStatus(s.waMessageId, s.status, s.error);
    },

    threads: () => inboxRepo.threads(),
    unreadTotal: () => inboxRepo.unreadTotal(),

    /** Opening a chat marks the client's messages as seen. Also says whether a free-text reply is still allowed. */
    async open(clientId: string, now = new Date()) {
      const c = await thread(clientId);
      const [messages, lastIn] = await Promise.all([inboxRepo.messages(clientId), inboxRepo.lastIncomingAt(clientId)]);
      await inboxRepo.markRead(clientId, now);
      const canReplyUntil = lastIn ? new Date(lastIn.getTime() + REPLY_WINDOW_MS) : null;
      return { client: c, messages, canReplyUntil: canReplyUntil && canReplyUntil > now ? canReplyUntil : null };
    },

    /**
     * A staff reply. WhatsApp only accepts free text within 24 hours of the client's last message, so it is refused
     * after that rather than sent and bounced. A failed send is kept, marked failed, so staff see it didn't go.
     */
    async reply(staffId: string, clientId: string, text: string, now = new Date()) {
      const parsed = replySchema.safeParse(text);
      if (!parsed.success) throw new DomainError("invalid", parsed.error.issues[0].message);
      const c = await thread(clientId);
      const lastIn = await inboxRepo.lastIncomingAt(clientId);
      if (!lastIn || now.getTime() - lastIn.getTime() > REPLY_WINDOW_MS) {
        throw new DomainError("invalid", `${c.name} last wrote more than 24 hours ago, so WhatsApp only allows an approved template now`);
      }
      try {
        const waMessageId = await deps.sendText(c.phoneE164, parsed.data);
        await inboxRepo.recordOutgoing({ clientId, body: parsed.data, waMessageId, status: "sent", error: null, sentBy: staffId });
      } catch (err) {
        if (!isUpstreamError(err) || err.code !== "delivery_failed") throw err;
        await inboxRepo.recordOutgoing({ clientId, body: parsed.data, waMessageId: null, status: "failed", error: err.message, sentBy: staffId });
        throw err;
      }
    },
  };
}
