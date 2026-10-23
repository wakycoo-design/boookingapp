export type ConversationKind = "direct" | "group" | "everyone" | "role";

export type ConversationRow = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  roleId: string | null;
  directKey: string | null;
  lastMessageAt: Date;
  previewBody: string | null;
  previewDeleted: boolean | null;
  previewSender: string | null;
  previewSenderId: string | null;
  unread: number;
};

/** One line in someone's conversation list. */
export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  /** The other person's name for a direct chat; the group, role or "Everyone" otherwise. */
  title: string;
  /** The other person, in a direct chat (for their avatar). */
  otherId: string | null;
  lastMessageAt: Date;
  preview: string | null;
  unread: number;
};

export type Member = { id: string; name: string; active: boolean; lastReadAt: Date | null };
export type AttachmentMeta = { id: string; fileName: string; contentType: string; size: number };

export type MessageRow = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  clientId: string | null;
  clientName: string | null;
  bookingId: string | null;
  bookingNumber: number | null;
  bookingStartsAt: Date | null;
  attachments: AttachmentMeta[];
};

/** A message as the chat shows it, with who has seen it. */
export type MessageDTO = Omit<MessageRow, "deletedAt"> & {
  deleted: boolean;
  seenBy: { id: string; name: string; at: Date }[];
};
