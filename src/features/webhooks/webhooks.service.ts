import { timingSafeEqual } from "node:crypto";
import { DomainError, UpstreamError } from "@/features/shared/errors";
import type { WhatsAppWebhookStatus } from "./webhooks.dto";
import type { createWebhooksRepository } from "./webhooks.repository";
import { parseWhatsAppPayload, validSignature } from "./whatsapp";

type Env = Record<string, string | undefined>;
/** A month of events is plenty to see the hookup works and to look into a missed message. */
const KEEP_DAYS = 30;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createWebhooksService({ webhooksRepo, env = process.env }: { webhooksRepo: ReturnType<typeof createWebhooksRepository>; env?: Env }) {
  return {
    status(): WhatsAppWebhookStatus {
      const token = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null;
      return { verifyTokenSet: Boolean(token), appSecretSet: Boolean(env.WHATSAPP_APP_SECRET), verifyToken: token };
    },

    /**
     * Meta's one-time check when the callback URL is saved: it sends our verify token and expects the challenge back.
     * Returns the challenge to echo.
     */
    verifySubscription(params: URLSearchParams): string {
      const token = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      if (!token) throw new UpstreamError("not_configured", "WhatsApp webhook isn't set up yet. Set WHATSAPP_WEBHOOK_VERIFY_TOKEN.");
      const challenge = params.get("hub.challenge");
      if (params.get("hub.mode") !== "subscribe" || !challenge) throw new DomainError("invalid", "Expected hub.mode=subscribe and a hub.challenge");
      if (!same(params.get("hub.verify_token") ?? "", token)) throw new DomainError("forbidden", "WhatsApp webhook verify token does not match");
      return challenge;
    },

    /** A signed delivery from Meta. Returns how many events it held. */
    async receive(rawBody: string, signature: string | null, now = new Date()): Promise<number> {
      const secret = env.WHATSAPP_APP_SECRET;
      if (!secret) throw new UpstreamError("not_configured", "WhatsApp webhook isn't set up yet. Set WHATSAPP_APP_SECRET.");
      if (!validSignature(rawBody, signature, secret)) throw new DomainError("forbidden", "WhatsApp webhook signature is missing or wrong");
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new DomainError("invalid", "WhatsApp webhook body must be JSON");
      }
      const events = parseWhatsAppPayload(body);
      await webhooksRepo.record("whatsapp", events, new Date(now.getTime() - KEEP_DAYS * 86_400_000));
      return events.length;
    },

    recent: (limit = 50) => webhooksRepo.recent(limit),
  };
}
