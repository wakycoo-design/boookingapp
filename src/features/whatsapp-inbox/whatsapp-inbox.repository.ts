import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { client, staff, whatsappMessage } from "@/db/schema";
import { upsertClient } from "@/features/clients/clients.repository";
import type { WaMessageDTO, WaThreadDTO } from "./whatsapp-inbox.dto";

// A status never goes backwards: a late "delivered" must not overwrite "read".
const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export function createWhatsappInboxRepository(db: Db) {
  return {
    /**
     * Saves a client's message. A number that isn't a client yet becomes one (named from their WhatsApp profile), so the
     * text always belongs to a client record. Meta may deliver the same message twice; the second copy is ignored.
     */
    async recordIncoming(m: { phoneE164: string; profileName: string | null; waMessageId: string; kind: string; body: string; at: Date }): Promise<void> {
      await db.transaction(async (tx) => {
        const [known] = await tx.select({ id: client.id }).from(client).where(eq(client.phoneE164, m.phoneE164));
        const clientId = known?.id ?? (await upsertClient(tx, { name: m.profileName?.trim() || `WhatsApp ${m.phoneE164}`, phoneE164: m.phoneE164, email: null, whatsappOptIn: true }));
        await tx
          .insert(whatsappMessage)
          .values({ clientId, direction: "in", kind: m.kind, body: m.body, waMessageId: m.waMessageId, status: "received", createdAt: m.at })
          .onConflictDoNothing({ target: whatsappMessage.waMessageId });
      });
    },

    async recordOutgoing(m: { clientId: string; body: string; waMessageId: string | null; status: "sent" | "failed"; error: string | null; sentBy: string }): Promise<void> {
      await db.insert(whatsappMessage).values({ ...m, direction: "out", kind: "text" });
    },

    async updateStatus(waMessageId: string, status: string, error: string | null): Promise<void> {
      if (!(status in RANK)) return;
      await db
        .update(whatsappMessage)
        .set({ status, error })
        .where(
          and(
            eq(whatsappMessage.waMessageId, waMessageId),
            eq(whatsappMessage.direction, "out"),
            sql`coalesce((case ${whatsappMessage.status} when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 end), 0) < ${RANK[status]}`,
          ),
        );
    },

    /** Every chat, the most recent first, with its last message and how many incoming messages nobody has opened. */
    async threads(): Promise<WaThreadDTO[]> {
      const rows = await db.execute<{ client_id: string; name: string; phone_e164: string; last_at: Date | string; preview: string; kind: string; direction: string; unread: number }>(sql`
        select distinct on (m.client_id) m.client_id, c.name, c.phone_e164, m.created_at as last_at, m.body as preview, m.kind, m.direction,
          (select count(*)::int from ${whatsappMessage} u where u.client_id = m.client_id and u.direction = 'in' and u.read_at is null) as unread
        from ${whatsappMessage} m join ${client} c on c.id = m.client_id
        order by m.client_id, m.created_at desc`);
      return rows.rows
        .map((r) => ({
          clientId: r.client_id,
          clientName: r.name,
          phoneE164: r.phone_e164,
          lastAt: new Date(r.last_at),
          preview: (r.direction === "out" ? "You: " : "") + (r.preview || `[${r.kind}]`),
          unread: r.unread,
        }))
        .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
    },

    async client(clientId: string): Promise<{ id: string; name: string; phoneE164: string } | null> {
      const [row] = await db.select({ id: client.id, name: client.name, phoneE164: client.phoneE164 }).from(client).where(eq(client.id, clientId));
      return row ?? null;
    },

    /** Oldest first, the last `limit` messages. */
    async messages(clientId: string, limit = 200): Promise<WaMessageDTO[]> {
      const rows = await db
        .select({
          id: whatsappMessage.id,
          direction: whatsappMessage.direction,
          kind: whatsappMessage.kind,
          body: whatsappMessage.body,
          status: whatsappMessage.status,
          error: whatsappMessage.error,
          sentByName: staff.name,
          createdAt: whatsappMessage.createdAt,
        })
        .from(whatsappMessage)
        .leftJoin(staff, eq(staff.id, whatsappMessage.sentBy))
        .where(eq(whatsappMessage.clientId, clientId))
        .orderBy(desc(whatsappMessage.createdAt))
        .limit(limit);
      return rows.reverse().map((r) => ({ ...r, status: r.status as WaMessageDTO["status"] }));
    },

    async lastIncomingAt(clientId: string): Promise<Date | null> {
      const [row] = await db
        .select({ at: whatsappMessage.createdAt })
        .from(whatsappMessage)
        .where(and(eq(whatsappMessage.clientId, clientId), eq(whatsappMessage.direction, "in")))
        .orderBy(desc(whatsappMessage.createdAt))
        .limit(1);
      return row?.at ?? null;
    },

    async markRead(clientId: string, now: Date): Promise<void> {
      await db
        .update(whatsappMessage)
        .set({ readAt: now })
        .where(and(eq(whatsappMessage.clientId, clientId), eq(whatsappMessage.direction, "in"), isNull(whatsappMessage.readAt)));
    },

    async unreadTotal(): Promise<number> {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(whatsappMessage)
        .where(and(eq(whatsappMessage.direction, "in"), isNull(whatsappMessage.readAt)));
      return row?.n ?? 0;
    },
  };
}
