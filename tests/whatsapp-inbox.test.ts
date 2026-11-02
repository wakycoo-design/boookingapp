import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, reset } from "./helpers";
import { createContainer } from "@/features/container";
import { UpstreamError } from "@/features/shared/errors";
import { createWebhooksRepository } from "@/features/webhooks/webhooks.repository";
import { createWebhooksService } from "@/features/webhooks/webhooks.service";

let sent: { to: string; body: string }[] = [];
let failWith: Error | null = null;
const c = createContainer(db, {
  waTextSender: async (to, body) => {
    if (failWith) throw failWith;
    sent.push({ to, body });
    return `wamid.out${sent.length}`;
  },
});
const env = { WHATSAPP_APP_SECRET: "s".repeat(32) };
const webhooks = createWebhooksService({ webhooksRepo: createWebhooksRepository(db), onChats: (x) => c.whatsappInbox.receive(x), env });

const deliver = (value: object) => {
  const body = JSON.stringify({ entry: [{ changes: [{ field: "messages", value }] }] });
  return webhooks.receive(body, `sha256=${createHmac("sha256", env.WHATSAPP_APP_SECRET).update(body).digest("hex")}`);
};
const incoming = (id: string, text: string, from = "919876543210", name = "Priya Nair", at = new Date()) =>
  deliver({ contacts: [{ wa_id: from, profile: { name } }], messages: [{ id, from, timestamp: String(Math.floor(at.getTime() / 1000)), type: "text", text: { body: text } }] });

let staffId = "";
beforeEach(async () => {
  await reset();
  sent = [];
  failWith = null;
  staffId = (await c.staff.create({}, { name: "Ameen", email: "ameen@firm.test", role: "admin" })).id;
});

const onlyThread = async () => (await c.whatsappInbox.threads())[0];

describe("WhatsApp inbox: receiving", () => {
  it("files a message from an unknown number under a new client named from their WhatsApp profile", async () => {
    await incoming("wamid.in1", "Can I move my session to Friday?");
    const t = await onlyThread();
    expect(t).toMatchObject({ clientName: "Priya Nair", phoneE164: "+919876543210", preview: "Can I move my session to Friday?", unread: 1 });
  });

  it("files a message from an existing client under that client, keeping their name", async () => {
    await db.execute(sql`insert into client (name, phone_e164) values ('Priya N. (from booking)', '+919876543210')`);
    await incoming("wamid.in1", "Hello");
    expect((await c.whatsappInbox.threads()).map((t) => t.clientName)).toEqual(["Priya N. (from booking)"]);
  });

  it("ignores Meta delivering the same message twice", async () => {
    await incoming("wamid.in1", "Hello");
    await incoming("wamid.in1", "Hello");
    expect((await onlyThread()).unread).toBe(1);
  });

  it("marks a client's messages as seen when the chat is opened", async () => {
    await incoming("wamid.in1", "Hello");
    await c.whatsappInbox.open((await onlyThread()).clientId);
    expect(await c.whatsappInbox.unreadTotal()).toBe(0);
  });

  it("deletes the chat with the client", async () => {
    await incoming("wamid.in1", "Hello");
    await db.execute(sql`delete from client`);
    expect(await c.whatsappInbox.threads()).toEqual([]);
  });

  it("answers not found for a link to a client that doesn't exist", async () => {
    await expect(c.whatsappInbox.open("not-a-uuid")).rejects.toThrow(/not found/);
    await expect(c.whatsappInbox.open("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/);
  });
});

describe("WhatsApp inbox: replying", () => {
  it("sends a reply to the client's number and shows it in the chat", async () => {
    await incoming("wamid.in1", "Can I move my session?");
    const { clientId } = await onlyThread();
    await c.whatsappInbox.reply(staffId, clientId, "  Yes, Friday 5pm works.  ");
    expect(sent).toEqual([{ to: "+919876543210", body: "Yes, Friday 5pm works." }]);
    const { messages } = await c.whatsappInbox.open(clientId);
    expect(messages.map((m) => [m.direction, m.body, m.status, m.sentByName])).toEqual([
      ["in", "Can I move my session?", "received", null],
      ["out", "Yes, Friday 5pm works.", "sent", "Ameen"],
    ]);
  });

  it("refuses a reply more than 24 hours after the client last wrote", async () => {
    await incoming("wamid.in1", "Hello", undefined, undefined, new Date(Date.now() - 25 * 3_600_000));
    const { clientId } = await onlyThread();
    await expect(c.whatsappInbox.reply(staffId, clientId, "Hi")).rejects.toThrow(/more than 24 hours ago/);
    expect((await c.whatsappInbox.open(clientId)).canReplyUntil).toBeNull();
    expect(sent).toEqual([]);
  });

  it("refuses an empty reply", async () => {
    await incoming("wamid.in1", "Hello");
    await expect(c.whatsappInbox.reply(staffId, (await onlyThread()).clientId, "   ")).rejects.toThrow(/Write a message/);
  });

  it("keeps a reply WhatsApp refused, marked failed", async () => {
    await incoming("wamid.in1", "Hello");
    const { clientId } = await onlyThread();
    failWith = new UpstreamError("delivery_failed", "WhatsApp refused the reply: bad number");
    await expect(c.whatsappInbox.reply(staffId, clientId, "Hi")).rejects.toThrow(/refused/);
    const last = (await c.whatsappInbox.open(clientId)).messages.at(-1);
    expect(last).toMatchObject({ direction: "out", status: "failed", error: "WhatsApp refused the reply: bad number" });
  });

  it("moves a reply's ticks forward with Meta's statuses, never back", async () => {
    await incoming("wamid.in1", "Hello");
    const { clientId } = await onlyThread();
    await c.whatsappInbox.reply(staffId, clientId, "Hi");
    await deliver({ statuses: [{ id: "wamid.out1", status: "read" }] });
    await deliver({ statuses: [{ id: "wamid.out1", status: "delivered" }] });
    expect((await c.whatsappInbox.open(clientId)).messages.at(-1)?.status).toBe("read");
  });
});
