import { desc, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { webhookEvent } from "@/db/schema";
import type { WebhookEventDTO, WebhookEventInput, WebhookKind } from "./webhooks.dto";

const columns = {
  id: webhookEvent.id,
  kind: webhookEvent.kind,
  detail: webhookEvent.detail,
  providerMessageId: webhookEvent.providerMessageId,
  receivedAt: webhookEvent.receivedAt,
};

export function createWebhooksRepository(db: Db) {
  return {
    /** Saves a delivery's events and drops ones older than `keepSince`, so the log never grows without bound. */
    async record(source: string, events: WebhookEventInput[], keepSince: Date): Promise<void> {
      await db.transaction(async (tx) => {
        if (events.length) await tx.insert(webhookEvent).values(events.map((e) => ({ ...e, source })));
        await tx.delete(webhookEvent).where(lt(webhookEvent.receivedAt, keepSince));
      });
    },

    /** Newest first. */
    async recent(limit: number): Promise<WebhookEventDTO[]> {
      const rows = await db.select(columns).from(webhookEvent).orderBy(desc(webhookEvent.receivedAt)).limit(limit);
      return rows.map((r) => ({ ...r, kind: r.kind as WebhookKind }));
    },
  };
}
