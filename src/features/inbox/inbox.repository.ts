import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { inboxItem } from "@/db/schema";
import type { InboxItemDTO } from "./inbox.dto";

const columns = {
  id: inboxItem.id,
  event: inboxItem.event,
  title: inboxItem.title,
  body: inboxItem.body,
  href: inboxItem.href,
  createdAt: inboxItem.createdAt,
  readAt: inboxItem.readAt,
};

export function createInboxRepository(db: Db) {
  return {
    async add(rows: { staffId: string; event: string; title: string; body: string | null; href: string | null }[]): Promise<void> {
      if (rows.length) await db.insert(inboxItem).values(rows);
    },

    list(staffId: string, limit: number): Promise<InboxItemDTO[]> {
      return db.select(columns).from(inboxItem).where(eq(inboxItem.staffId, staffId)).orderBy(desc(inboxItem.createdAt)).limit(limit);
    },

    async unread(staffId: string): Promise<number> {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(inboxItem).where(and(eq(inboxItem.staffId, staffId), isNull(inboxItem.readAt)));
      return row?.n ?? 0;
    },

    /** Marks one as read and says where it leads; null when it isn't theirs. */
    async open(staffId: string, id: string): Promise<{ href: string | null } | null> {
      const [row] = await db
        .update(inboxItem)
        .set({ readAt: sql`coalesce(${inboxItem.readAt}, now())` })
        .where(and(eq(inboxItem.id, id), eq(inboxItem.staffId, staffId)))
        .returning({ href: inboxItem.href });
      return row ?? null;
    },

    async readAll(staffId: string): Promise<void> {
      await db.update(inboxItem).set({ readAt: sql`now()` }).where(and(eq(inboxItem.staffId, staffId), isNull(inboxItem.readAt)));
    },
  };
}

export type InboxRepository = ReturnType<typeof createInboxRepository>;
