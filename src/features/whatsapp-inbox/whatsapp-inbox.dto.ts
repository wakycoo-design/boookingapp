/** One client's WhatsApp chat, as the inbox list shows it. */
export type WaThreadDTO = {
  clientId: string;
  clientName: string;
  phoneE164: string;
  lastAt: Date;
  preview: string;
  unread: number;
};

export type WaMessageDTO = {
  id: string;
  direction: "in" | "out";
  kind: string;
  body: string;
  status: "received" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  sentByName: string | null;
  createdAt: Date;
};

/** WhatsApp only lets a business write freely for 24 hours after the client's last message; after that a template is needed. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
