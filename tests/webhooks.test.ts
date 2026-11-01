import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./helpers";
import { createWebhooksRepository } from "@/features/webhooks/webhooks.repository";
import { createWebhooksService } from "@/features/webhooks/webhooks.service";
import { parseWhatsAppPayload } from "@/features/webhooks/whatsapp";

const env = { WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me-please", WHATSAPP_APP_SECRET: "s".repeat(32) };
const webhooksRepo = createWebhooksRepository(db);
const svc = createWebhooksService({ webhooksRepo, env });
const sign = (body: string, secret = env.WHATSAPP_APP_SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const params = (p: Record<string, string>) => new URLSearchParams(p);

const delivery = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{
    id: "WABA",
    changes: [
      { field: "messages", value: { contacts: [{ wa_id: "919876543210" }], messages: [{ id: "wamid.in1", from: "919876543210", type: "text", text: { body: "Can I move my session?" } }] } },
      { field: "messages", value: { statuses: [{ id: "wamid.out1", status: "read", recipient_id: "919876543210" }, { id: "wamid.out2", status: "failed", errors: [{ code: 131026 }] }] } },
      { field: "message_template_status_update", value: { event: "REJECTED", message_template_name: "booking_confirmed", reason: "INVALID_FORMAT" } },
    ],
  }],
});

beforeEach(async () => {
  await db.execute(sql`delete from webhook_event`);
});

describe("WhatsApp webhook verification", () => {
  it("echoes the challenge when the verify token matches", () => {
    expect(svc.verifySubscription(params({ "hub.mode": "subscribe", "hub.verify_token": env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, "hub.challenge": "1158201444" }))).toBe("1158201444");
  });

  it("refuses a wrong verify token", () => {
    expect(() => svc.verifySubscription(params({ "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "1" }))).toThrow(/does not match/);
  });

  it("refuses a request that isn't a subscribe check", () => {
    expect(() => svc.verifySubscription(params({ "hub.verify_token": env.WHATSAPP_WEBHOOK_VERIFY_TOKEN }))).toThrow(/hub.mode=subscribe/);
  });

  it("says what to set when no verify token is configured", () => {
    const bare = createWebhooksService({ webhooksRepo, env: {} });
    expect(() => bare.verifySubscription(params({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1" }))).toThrow(/WHATSAPP_WEBHOOK_VERIFY_TOKEN/);
    expect(bare.status()).toEqual({ verifyTokenSet: false, appSecretSet: false, verifyToken: null });
  });
});

describe("WhatsApp webhook events", () => {
  it("records messages, statuses and template reviews from a signed delivery", async () => {
    expect(await svc.receive(delivery, sign(delivery))).toBe(4);
    const events = await svc.recent();
    expect(events.map((e) => [e.kind, e.detail, e.providerMessageId]).sort()).toEqual([
      ["message", "text", "wamid.in1"],
      ["status", "failed (error 131026)", "wamid.out2"],
      ["status", "read", "wamid.out1"],
      ["template", "booking_confirmed: REJECTED, INVALID_FORMAT", null],
    ]);
  });

  it("never stores the client's number or message text", async () => {
    await svc.receive(delivery, sign(delivery));
    const stored = JSON.stringify(await svc.recent());
    expect(stored).not.toContain("919876543210");
    expect(stored).not.toContain("move my session");
  });

  it("refuses a delivery with a wrong or missing signature", async () => {
    await expect(svc.receive(delivery, sign(delivery, "x".repeat(32)))).rejects.toThrow(/signature/);
    await expect(svc.receive(delivery, null)).rejects.toThrow(/signature/);
    expect(await svc.recent()).toEqual([]);
  });

  it("refuses every delivery until the app secret is set", async () => {
    const noSecret = createWebhooksService({ webhooksRepo, env: { WHATSAPP_WEBHOOK_VERIFY_TOKEN: "t" } });
    await expect(noSecret.receive(delivery, sign(delivery))).rejects.toThrow(/WHATSAPP_APP_SECRET/);
  });

  it("drops events older than 30 days when new ones arrive", async () => {
    await db.execute(sql`insert into webhook_event (source, kind, detail, received_at) values ('whatsapp', 'status', 'sent', now() - interval '31 days')`);
    await svc.receive(delivery, sign(delivery));
    expect((await svc.recent()).some((e) => e.detail === "sent")).toBe(false);
  });

  it("keeps an unknown field as 'other' instead of losing it", () => {
    expect(parseWhatsAppPayload({ entry: [{ changes: [{ field: "account_update", value: {} }] }] })).toEqual([{ kind: "other", detail: "account_update", providerMessageId: null }]);
  });
});
