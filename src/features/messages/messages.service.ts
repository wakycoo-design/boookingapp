import { DomainError } from "@/features/shared/errors";
import { isUuid } from "@/features/shared/validation";
import { permissionKey, type Permissions } from "@/features/access/access.dto";
import type { Notice } from "@/features/inbox/inbox.service";
import type { ConversationKind, ConversationSummary, Member, MessageDTO } from "./messages.dto";
import type { MessagesRepository } from "./messages.repository";

/** Who is acting, with what they may do (Roles & permissions). */
export type Chatter = { id: string; name: string; roleId: string | null; permissions: Permissions };

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 5;
const FILE_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;
const MAX_BODY = 4000;

const allowed = (me: Chatter, feature: string, action: Parameters<typeof permissionKey>[1]) => me.permissions.has(permissionKey(feature, action));

/**
 * Team messages: one-to-one chats, groups, and conversations with everyone or a whole role, where everyone can reply.
 * "Seen by" comes from how far each member has read. Direct and group members are fixed; Everyone and role conversations
 * follow the staff list, so new hires join and leavers drop out by themselves.
 */
export function createMessagesService(deps: {
  messagesRepo: MessagesRepository;
  /** Active staff and roles, to check who can be added and to name role conversations. */
  activeStaff: () => Promise<{ id: string; name: string }[]>;
  roleName: (roleId: string) => Promise<string | null>;
  notify: (n: Notice) => Promise<unknown>;
}) {
  const { messagesRepo: repo } = deps;

  async function open(me: Chatter, conversationId: string) {
    if (!allowed(me, "messages", "view")) throw new DomainError("forbidden", "Messages aren't switched on for your role");
    const c = isUuid(conversationId) ? await repo.find(conversationId) : null;
    if (!c) throw new DomainError("not_found", `Conversation ${conversationId} not found`);
    const member =
      c.kind === "everyone" ||
      // Whoever may message whole roles can read and post in every role conversation, not just their own role's.
      (c.kind === "role" && ((c.roleId !== null && c.roleId === me.roleId) || allowed(me, "messages.announcements", "add"))) ||
      ((c.kind === "direct" || c.kind === "group") && (await repo.isListedMember(c.id, me.id)));
    if (!member) throw new DomainError("forbidden", "You aren't in this conversation");
    return c;
  }

  async function title(c: { kind: ConversationKind; title: string | null; roleId: string | null; directKey: string | null }, me: { id: string }) {
    if (c.kind === "everyone") return "Everyone";
    if (c.kind === "role") return c.title ?? (c.roleId ? `All ${(await deps.roleName(c.roleId)) ?? "role"}` : "Role");
    if (c.kind === "direct") {
      const otherId = c.directKey?.split(":").find((id) => id !== me.id);
      return (await deps.activeStaff()).find((s) => s.id === otherId)?.name ?? c.title ?? "Former staff member";
    }
    return c.title ?? "Group";
  }

  /** "@Name" for each member mentioned (longest names first, so "@Asha Rao" beats "@Asha"). */
  function mentioned(body: string, people: Member[], me: Chatter) {
    const text = body.toLowerCase();
    return people
      .filter((p) => p.id !== me.id && p.active)
      .sort((a, b) => b.name.length - a.name.length)
      .filter((p) => text.includes(`@${p.name.toLowerCase()}`));
  }

  return {
    open,

    async list(me: Chatter): Promise<ConversationSummary[]> {
      if (!allowed(me, "messages", "view")) return [];
      const rows = await repo.listFor({ ...me, announcer: allowed(me, "messages.announcements", "add") });
      return Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          kind: r.kind,
          title: await title(r, me),
          otherId: r.kind === "direct" ? (r.directKey?.split(":").find((id) => id !== me.id) ?? null) : null,
          lastMessageAt: r.lastMessageAt,
          preview: r.previewDeleted ? "Message deleted" : r.previewBody ? `${r.previewSenderId === me.id ? "You" : r.previewSender?.split(" ")[0]}: ${r.previewBody}` : null,
          unread: r.unread,
        })),
      );
    },

    async unreadTotal(me: Chatter) {
      return (await this.list(me)).reduce((n, c) => n + c.unread, 0);
    },

    async conversation(me: Chatter, conversationId: string) {
      const c = await open(me, conversationId);
      const members = await repo.members(c);
      return { id: c.id, kind: c.kind, title: await title(c, me), members };
    },

    /** Messages with who has seen each; `after` fetches only newer ones (the open chat checks every few seconds). */
    async messages(me: Chatter, conversationId: string, opts: { after?: Date; before?: Date; limit?: number } = {}): Promise<MessageDTO[]> {
      const c = await open(me, conversationId);
      const [rows, members] = await Promise.all([repo.messages(c.id, { ...opts, limit: Math.min(opts.limit ?? 100, 200) }), repo.members(c)]);
      return rows.map(({ deletedAt, ...m }) => ({
        ...m,
        deleted: deletedAt !== null,
        seenBy: members
          .filter((p) => p.id !== m.senderId && p.lastReadAt && p.lastReadAt >= m.createdAt)
          .map((p) => ({ id: p.id, name: p.name, at: p.lastReadAt! })),
      }));
    },

    async markRead(me: Chatter, conversationId: string) {
      const c = await open(me, conversationId);
      await repo.markRead(c.id, me.id);
    },

    /** A one-to-one chat with someone: the one they already have, or a new one. */
    async startDirect(me: Chatter, otherId: string) {
      if (!allowed(me, "messages", "add")) throw new DomainError("forbidden", "Your role can't start new chats");
      if (otherId === me.id) throw new DomainError("invalid", "Pick someone else to message");
      if (!(await deps.activeStaff()).some((s) => s.id === otherId)) throw new DomainError("not_found", `Staff member ${otherId} not found`);
      const key = [me.id, otherId].sort().join(":");
      return (await repo.findDirect(key)) ?? repo.create({ kind: "direct", title: null, roleId: null, directKey: key, createdBy: me.id, memberIds: [me.id, otherId] });
    },

    async createGroup(me: Chatter, input: { title: string; memberIds: string[] }) {
      if (!allowed(me, "messages", "add")) throw new DomainError("forbidden", "Your role can't start new chats");
      const title = input.title.trim().replace(/\s+/g, " ");
      if (!title || title.length > 80) throw new DomainError("invalid", "Give the group a name of up to 80 characters");
      const active = new Set((await deps.activeStaff()).map((s) => s.id));
      const ids = [...new Set([me.id, ...input.memberIds])].filter((id) => active.has(id));
      if (ids.length < 2) throw new DomainError("invalid", "Add at least one other person to the group");
      return repo.create({ kind: "group", title, roleId: null, directKey: null, createdBy: me.id, memberIds: ids });
    },

    /** The conversation with everyone who has a role (one per role). */
    async roleConversation(me: Chatter, roleId: string) {
      if (!allowed(me, "messages.announcements", "add")) throw new DomainError("forbidden", "Your role can't message a whole role");
      const name = isUuid(roleId) ? await deps.roleName(roleId) : null;
      if (!name) throw new DomainError("not_found", `Role ${roleId} not found`);
      return (await repo.findRoleConversation(roleId)) ?? repo.create({ kind: "role", title: `All ${name}`, roleId, directKey: null, createdBy: me.id, memberIds: [] });
    },

    async send(me: Chatter, conversationId: string, input: { body: string; clientId?: string | null; bookingId?: string | null; files?: { fileName: string; contentType: string; data: Buffer }[] }) {
      const c = await open(me, conversationId);
      const body = input.body.trim();
      const files = input.files ?? [];
      if (!body && !files.length && !input.clientId && !input.bookingId) throw new DomainError("invalid", "Write a message first");
      if (body.length > MAX_BODY) throw new DomainError("invalid", `Keep messages under ${MAX_BODY} characters`);
      if (files.length > MAX_FILES) throw new DomainError("invalid", `Attach up to ${MAX_FILES} files at a time`);
      for (const f of files) {
        if (!FILE_TYPES.test(f.contentType)) throw new DomainError("invalid", `"${f.fileName}" isn't an image or PDF`);
        if (f.data.length > MAX_FILE_BYTES) throw new DomainError("invalid", `"${f.fileName}" is over 5 MB`);
      }
      for (const [id, what] of [[input.clientId, "client"], [input.bookingId, "booking"]] as const) {
        if (id && !isUuid(id)) throw new DomainError("invalid", `That ${what} link isn't valid`);
      }
      const id = await repo.send({
        conversationId: c.id,
        senderId: me.id,
        body,
        clientId: input.clientId ?? null,
        bookingId: input.bookingId ?? null,
        files: files.map((f) => ({ ...f, fileName: f.fileName.replace(/[\\/\r\n]/g, "_").slice(0, 200) })),
      });
      if (body.includes("@")) {
        const where = await title(c, me);
        for (const p of mentioned(body, await repo.members(c), me)) {
          await deps.notify({
            event: "message.mention",
            title: `${me.name} mentioned you in ${c.kind === "direct" ? "a message" : where}`,
            body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
            href: `/admin/messages/${c.id}`,
            ownerId: p.id,
            actorId: me.id,
          });
        }
      }
      return id;
    },

    async edit(me: Chatter, messageId: string, body: string) {
      const m = isUuid(messageId) ? await repo.findMessage(messageId) : null;
      if (!m) throw new DomainError("not_found", `Message ${messageId} not found`);
      await open(me, m.conversationId);
      if (m.senderId !== me.id) throw new DomainError("forbidden", "You can only edit your own messages");
      if (m.deletedAt) throw new DomainError("invalid", "That message was deleted");
      const text = body.trim();
      if (!text) throw new DomainError("invalid", "A message can't be empty; delete it instead");
      if (text.length > MAX_BODY) throw new DomainError("invalid", `Keep messages under ${MAX_BODY} characters`);
      await repo.edit(m.id, text);
    },

    async remove(me: Chatter, messageId: string) {
      const m = isUuid(messageId) ? await repo.findMessage(messageId) : null;
      if (!m) throw new DomainError("not_found", `Message ${messageId} not found`);
      await open(me, m.conversationId);
      if (m.senderId !== me.id && !allowed(me, "messages.moderate", "delete")) throw new DomainError("forbidden", "You can only delete your own messages");
      await repo.remove(m.id);
    },

    async attachment(me: Chatter, attachmentId: string) {
      const a = isUuid(attachmentId) ? await repo.attachment(attachmentId) : null;
      if (!a) throw new DomainError("not_found", `File ${attachmentId} not found`);
      await open(me, a.conversationId);
      return a;
    },
  };
}

export type MessagesService = ReturnType<typeof createMessagesService>;
