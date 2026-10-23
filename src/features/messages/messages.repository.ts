import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { booking, client, conversation, conversationMember, message, messageAttachment, staff } from "@/db/schema";
import type { AttachmentMeta, ConversationKind, ConversationRow, Member, MessageRow } from "./messages.dto";

/** `announcer`: may message whole roles, so sees every role conversation as well as their own role's. */
type Viewer = { id: string; roleId: string | null; announcer: boolean };

export function createMessagesRepository(db: Db) {
  /** The conversations someone is in: their direct chats and groups, Everyone, and their role's conversation. */
  async function listFor(me: Viewer): Promise<ConversationRow[]> {
    const res = await db.execute(sql`
      select c.id, c.kind, c.title, c.role_id as "roleId", c.direct_key as "directKey", c.last_message_at as "lastMessageAt",
        lm.body as "previewBody", lm.deleted_at is not null as "previewDeleted", ls.name as "previewSender", lm.sender_id as "previewSenderId",
        (select count(*)::int from message m
          where m.conversation_id = c.id and m.sender_id <> ${me.id} and m.deleted_at is null
            and m.created_at > coalesce(mine.last_read_at, (select created_at from staff where id = ${me.id}))) as unread
      from conversation c
      left join conversation_member mine on mine.conversation_id = c.id and mine.staff_id = ${me.id}
      left join lateral (select * from message m where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
      left join staff ls on ls.id = lm.sender_id
      where (c.kind in ('direct', 'group') and mine.listed)
        or c.kind = 'everyone'
        or (c.kind = 'role' and (${me.announcer} or (c.role_id is not distinct from ${me.roleId}::uuid and ${me.roleId}::uuid is not null)))
      order by c.last_message_at desc`);
    return res.rows as ConversationRow[];
  }

  async function find(id: string) {
    const [row] = await db
      .select({ id: conversation.id, kind: conversation.kind, title: conversation.title, roleId: conversation.roleId, directKey: conversation.directKey })
      .from(conversation)
      .where(eq(conversation.id, id));
    return row ? { ...row, kind: row.kind as ConversationKind } : null;
  }

  /** Everyone in it with how far they have read. Everyone/role conversations follow the staff list as it is now. */
  async function members(c: { id: string; kind: ConversationKind; roleId: string | null }): Promise<Member[]> {
    // Written out in full: inside a subquery Drizzle leaves column names unqualified.
    const read = sql`(select cm.last_read_at from conversation_member cm where cm.conversation_id = ${c.id} and cm.staff_id = "staff"."id")`;
    const cols = { id: staff.id, name: staff.name, active: staff.active, lastReadAt: sql<Date | null>`${read}` };
    // A raw subquery returns its timestamp as text, so it is turned back into a Date for the "seen" comparison.
    const asDates = (rows: { id: string; name: string; active: boolean; lastReadAt: Date | string | null }[]): Member[] =>
      rows.map((r) => ({ ...r, lastReadAt: r.lastReadAt ? new Date(r.lastReadAt) : null }));
    if (c.kind === "everyone") return asDates(await db.select(cols).from(staff).where(eq(staff.active, true)).orderBy(asc(staff.name)));
    if (c.kind === "role") {
      if (!c.roleId) return [];
      return asDates(await db.select(cols).from(staff).where(and(eq(staff.active, true), eq(staff.roleId, c.roleId))).orderBy(asc(staff.name)));
    }
    return db
      .select({ id: staff.id, name: staff.name, active: staff.active, lastReadAt: conversationMember.lastReadAt })
      .from(conversationMember)
      .innerJoin(staff, eq(staff.id, conversationMember.staffId))
      .where(and(eq(conversationMember.conversationId, c.id), eq(conversationMember.listed, true)))
      .orderBy(asc(staff.name));
  }

  async function messages(conversationId: string, opts: { after?: Date; before?: Date; limit: number }): Promise<MessageRow[]> {
    const where = [eq(message.conversationId, conversationId)];
    if (opts.after) where.push(gt(message.createdAt, opts.after));
    if (opts.before) where.push(lt(message.createdAt, opts.before));
    const rows = await db
      .select({
        id: message.id,
        senderId: message.senderId,
        senderName: staff.name,
        body: message.body,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
        deletedAt: message.deletedAt,
        clientId: message.clientId,
        clientName: client.name,
        bookingId: message.bookingId,
        bookingNumber: booking.number,
        bookingStartsAt: booking.startsAt,
      })
      .from(message)
      .innerJoin(staff, eq(staff.id, message.senderId))
      .leftJoin(client, eq(client.id, message.clientId))
      .leftJoin(booking, eq(booking.id, message.bookingId))
      .where(and(...where))
      // Newest first so "the latest N" works; turned back into reading order below.
      .orderBy(desc(message.createdAt))
      .limit(opts.limit);
    rows.reverse();
    const files = rows.length ? await attachmentsOf(rows.map((r) => r.id)) : [];
    return rows.map((r) => ({ ...r, attachments: files.filter((f) => f.messageId === r.id) }));
  }

  async function attachmentsOf(messageIds: string[]): Promise<(AttachmentMeta & { messageId: string })[]> {
    return db
      .select({ id: messageAttachment.id, messageId: messageAttachment.messageId, fileName: messageAttachment.fileName, contentType: messageAttachment.contentType, size: messageAttachment.size })
      .from(messageAttachment)
      .where(inArray(messageAttachment.messageId, messageIds));
  }

  return {
    listFor,
    find,
    members,
    messages,

    async findDirect(key: string) {
      const [row] = await db.select({ id: conversation.id }).from(conversation).where(eq(conversation.directKey, key));
      return row?.id ?? null;
    },

    async findRoleConversation(roleId: string) {
      const [row] = await db.select({ id: conversation.id }).from(conversation).where(and(eq(conversation.kind, "role"), eq(conversation.roleId, roleId)));
      return row?.id ?? null;
    },

    async create(data: { kind: ConversationKind; title: string | null; roleId: string | null; directKey: string | null; createdBy: string; memberIds: string[] }) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(conversation)
          .values({ kind: data.kind, title: data.title, roleId: data.roleId, directKey: data.directKey, createdBy: data.createdBy })
          .returning({ id: conversation.id });
        if (data.memberIds.length) {
          await tx.insert(conversationMember).values(data.memberIds.map((staffId) => ({ conversationId: row.id, staffId, listed: true })));
        }
        return row.id;
      });
    },

    async isListedMember(conversationId: string, staffId: string) {
      const [row] = await db
        .select({ n: sql<number>`1` })
        .from(conversationMember)
        .where(and(eq(conversationMember.conversationId, conversationId), eq(conversationMember.staffId, staffId), eq(conversationMember.listed, true)));
      return Boolean(row);
    },

    async send(data: { conversationId: string; senderId: string; body: string; clientId: string | null; bookingId: string | null; files: { fileName: string; contentType: string; data: Buffer }[] }) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(message)
          .values({ conversationId: data.conversationId, senderId: data.senderId, body: data.body, clientId: data.clientId, bookingId: data.bookingId })
          .returning({ id: message.id, createdAt: message.createdAt });
        if (data.files.length) {
          await tx.insert(messageAttachment).values(data.files.map((f) => ({ messageId: row.id, fileName: f.fileName, contentType: f.contentType, size: f.data.length, data: f.data })));
        }
        await tx.update(conversation).set({ lastMessageAt: row.createdAt }).where(eq(conversation.id, data.conversationId));
        // Sending counts as having read everything up to it.
        await tx
          .insert(conversationMember)
          .values({ conversationId: data.conversationId, staffId: data.senderId, listed: false, lastReadAt: row.createdAt })
          .onConflictDoUpdate({ target: [conversationMember.conversationId, conversationMember.staffId], set: { lastReadAt: row.createdAt } });
        return row.id;
      });
    },

    async findMessage(id: string) {
      const [row] = await db
        .select({ id: message.id, conversationId: message.conversationId, senderId: message.senderId, deletedAt: message.deletedAt })
        .from(message)
        .where(eq(message.id, id));
      return row ?? null;
    },

    async edit(id: string, body: string) {
      await db.update(message).set({ body, editedAt: sql`now()` }).where(eq(message.id, id));
    },

    /** Keeps the row (so the conversation still reads in order) but drops its words, links and files. */
    async remove(id: string) {
      await db.transaction(async (tx) => {
        await tx.update(message).set({ body: "", clientId: null, bookingId: null, deletedAt: sql`now()` }).where(eq(message.id, id));
        await tx.delete(messageAttachment).where(eq(messageAttachment.messageId, id));
      });
    },

    async markRead(conversationId: string, staffId: string) {
      await db
        .insert(conversationMember)
        .values({ conversationId, staffId, listed: false, lastReadAt: sql`now()` })
        .onConflictDoUpdate({ target: [conversationMember.conversationId, conversationMember.staffId], set: { lastReadAt: sql`now()` } });
    },

    async attachment(id: string) {
      const [row] = await db
        .select({ fileName: messageAttachment.fileName, contentType: messageAttachment.contentType, data: messageAttachment.data, conversationId: message.conversationId })
        .from(messageAttachment)
        .innerJoin(message, eq(message.id, messageAttachment.messageId))
        .where(eq(messageAttachment.id, id));
      return row ?? null;
    },
  };
}

export type MessagesRepository = ReturnType<typeof createMessagesRepository>;
