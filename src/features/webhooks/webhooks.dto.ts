/** The three things Meta's WhatsApp webhook tells us; anything else is kept as "other" so nothing is silently lost. */
export const WEBHOOK_KINDS = ["message", "status", "template", "other"] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

/** One event, already stripped of phone numbers and message text. */
export type WebhookEventInput = { kind: WebhookKind; detail: string; providerMessageId: string | null };
export type WebhookEventDTO = WebhookEventInput & { id: string; receivedAt: Date };

/** What Settings > Webhooks needs to show whether the hookup is ready. Never carries the app secret itself. */
export type WhatsAppWebhookStatus = {
  verifyTokenSet: boolean;
  appSecretSet: boolean;
  /** Shown to admins so they can paste it into Meta; it is only a shared word, not a key that grants access. */
  verifyToken: string | null;
};
