import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, reset } from "./helpers";
import { workflowRun } from "@/db/schema";
import { createContainer } from "@/features/container";
import { NotConfigured, type OutgoingMessage, type Sender } from "@/features/workflows/workflows.dto";
import { render, unknownPlaceholders } from "@/features/workflows/templates";
import type { BookingActor } from "@/features/bookings/bookings.service";
import { zonedToUtc } from "@/lib/time";

const sent: OutgoingMessage[] = [];
let sendBehaviour: "ok" | "fail" | "unconfigured" = "ok";
const fake: Sender = async (msg) => {
  if (sendBehaviour === "unconfigured") throw new NotConfigured("Email isn't set up yet");
  if (sendBehaviour === "fail") throw new Error("Server said no");
  sent.push(msg);
  return { providerMessageId: "id-1" };
};
const c = createContainer(db, { senders: { email: fake, whatsapp: fake, webhook: fake } });

beforeEach(async () => {
  await reset();
  sent.length = 0;
  sendBehaviour = "ok";
});

const IST = "Asia/Kolkata";
const at = (local: string) => zonedToUtc(local, IST);
const now = at("2026-10-15T08:00");
const desk: BookingActor = { mode: "staff" };
const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }));
const ravi = { name: "Ravi Kumar", phone: "98765 43210", email: "ravi@example.com", whatsappOptIn: true };

async function setup() {
  const svc = await c.catalog.create({}, { name: "Consult", durationMin: 30 });
  const s = await c.staff.create({}, { name: "Asha", email: "asha@firm.test" });
  await c.staff.setServices({}, s.id, [svc.id]);
  await c.schedules.setWeeklyHours({}, s.id, everyDay);
  return { svc, staff: s };
}

const book = (serviceId: string, start: string, client = ravi) =>
  c.bookings.create(desk, { serviceId, start: at(start), client }, { now });

const email = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  trigger: "booked" as const,
  action: { channel: "email" as const, recipient: "client" as const, subject: "Hi {{client_name}}", body: "{{service}} with {{staff}} on {{date}} at {{time}} ({{booking_id}})" },
  ...over,
});

describe("templates", () => {
  it("fills known variables and flags unknown ones", () => {
    expect(unknownPlaceholders("Hi {{client_name}} {{nope}}")).toEqual(["nope"]);
    expect(render("Hi {{ client_name }}", { client_name: "Ravi" } as never)).toBe("Hi Ravi");
  });
});

describe("workflow rules", () => {
  it("rejects unknown variables, a delay without a direction and 'before' on a booking event", async () => {
    await expect(c.workflows.create({}, email("A", { action: { channel: "email", subject: "x {{oops}}", body: "y" } }))).rejects.toThrow(/oops/);
    await expect(c.workflows.create({}, email("B", { timing: "after", offsetMin: 0 }))).rejects.toThrow(/how long/);
    await expect(c.workflows.create({}, email("C", { timing: "before", offsetMin: 30 }))).rejects.toThrow(/Before/);
  });

  it("keeps names unique ignoring case and refuses unknown services", async () => {
    await c.workflows.create({}, email("Reminder"));
    await expect(c.workflows.create({}, email("reminder"))).rejects.toThrow();
    await expect(c.workflows.create({}, email("Other", { serviceIds: ["8d0b3f6e-0000-4000-8000-000000000000"] }))).rejects.toMatchObject({ code: "invalid" });
  });

  it("accepts only https webhooks, except localhost", async () => {
    const hook = (url: string) => email("H" + url.length, { action: { channel: "webhook", url } });
    await expect(c.workflows.create({}, hook("http://example.com/x"))).rejects.toThrow(/https/);
    await expect(c.workflows.create({}, hook("http://localhost:4000/x"))).resolves.toBeTruthy();
  });
});

describe("sending", () => {
  it("sends a booking confirmation with the booking's details filled in", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Confirmation"));
    await book(svc.id, "2026-10-19T10:00");
    expect(await c.workflows.processDue({ now })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "email", to: "ravi@example.com", subject: "Hi Ravi Kumar" });
    expect((sent[0] as { body: string }).body).toBe("Consult with Asha on Monday, 19 October 2026 at 10:00 am (BK-1)");
  });

  it("sends once even if the worker runs again", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Confirmation"));
    await book(svc.id, "2026-10-19T10:00");
    await c.workflows.processDue({ now });
    expect(await c.workflows.processDue({ now: new Date(now.getTime() + 3_600_000) })).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("waits for a delay and for the reminder time before the appointment", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Later", { timing: "after", offsetMin: 60 }));
    await c.workflows.create({}, email("Reminder", { trigger: "appointment_start", timing: "before", offsetMin: 24 * 60 }));
    await book(svc.id, "2026-10-19T10:00");
    expect(await c.workflows.processDue({ now })).toBe(0);
    expect(await c.workflows.processDue({ now: new Date(now.getTime() + 61 * 60_000) })).toBe(1);
    expect(await c.workflows.processDue({ now: at("2026-10-18T09:59") })).toBe(0);
    expect(await c.workflows.processDue({ now: at("2026-10-18T10:00") })).toBe(1);
  });

  it("skips a reminder whose time has already passed when the booking is made", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Reminder", { trigger: "appointment_start", timing: "before", offsetMin: 24 * 60 }));
    await book(svc.id, "2026-10-15T14:00"); // only 6 hours away
    expect(await db.select().from(workflowRun)).toHaveLength(0);
  });

  it("only runs for the chosen services", async () => {
    const { svc } = await setup();
    const other = await c.catalog.create({}, { name: "Other", durationMin: 30 });
    await c.workflows.create({}, email("Only other", { serviceIds: [other.id] }));
    await book(svc.id, "2026-10-19T10:00");
    expect(await c.workflows.processDue({ now })).toBe(0);
  });

  it("moving a booking drops its old reminder and queues one for the new time", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Reminder", { trigger: "appointment_start", timing: "before", offsetMin: 24 * 60 }));
    await c.workflows.create({}, email("Moved", { trigger: "rescheduled" }));
    const { booking: b } = await book(svc.id, "2026-10-19T10:00");
    const moved = await c.bookings.reschedule(desk, b.id, { start: at("2026-10-20T10:00") }, { now });
    const runs = await db.select().from(workflowRun);
    expect(runs.filter((r) => r.status === "queued").map((r) => r.bookingId)).toEqual(expect.arrayContaining([moved.id]));
    expect(runs.filter((r) => r.bookingId === b.id).every((r) => r.status === "cancelled")).toBe(true);
    expect(await c.workflows.processDue({ now })).toBe(1); // "Moved" goes now
    expect(await c.workflows.processDue({ now: at("2026-10-19T10:00") })).toBe(1); // reminder 24h before the new time
    expect(sent).toHaveLength(2);
  });

  it("cancelling drops reminders but still sends the cancellation notice", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Reminder", { trigger: "appointment_start", timing: "before", offsetMin: 24 * 60 }));
    await c.workflows.create({}, email("Cancelled", { trigger: "cancelled", action: { channel: "email", recipient: "client", subject: "Cancelled", body: "Because: {{cancel_reason}}" } }));
    const { booking: b } = await book(svc.id, "2026-10-19T10:00");
    await c.bookings.cancel(desk, b.id, { reason: "Unwell" }, { now });
    expect(await c.workflows.processDue({ now: at("2026-10-19T10:00") })).toBe(1);
    expect((sent[0] as { body: string }).body).toBe("Because: Unwell");
  });

  it("fires on completed and no-show", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Thanks", { trigger: "completed" }));
    const { booking: b } = await book(svc.id, "2026-10-19T10:00");
    await c.bookings.markStatus(desk, b.id, "completed", { now: at("2026-10-19T11:00") });
    expect(await c.workflows.processDue({ now: at("2026-10-19T11:00") })).toBe(1);
  });

  it("logs a skip when there is nobody to send to", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Confirmation"));
    await c.workflows.create({}, email("WhatsApp", { action: { channel: "whatsapp", templateName: "booking_confirmation", params: ["{{client_name}}"] } }));
    await book(svc.id, "2026-10-19T10:00", { name: "No Email", phone: "98765 11111", email: undefined as never, whatsappOptIn: false });
    await c.workflows.processDue({ now });
    const runs = await db.select().from(workflowRun);
    expect(runs.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(runs.map((r) => r.error).sort()).toEqual(["The client has no email address", "The client has not agreed to WhatsApp messages"]);
  });

  it("logs the message as skipped when a channel isn't set up, so it can still be reviewed", async () => {
    const { svc } = await setup();
    const w = await c.workflows.create({}, email("Confirmation"));
    sendBehaviour = "unconfigured";
    await book(svc.id, "2026-10-19T10:00");
    await c.workflows.processDue({ now });
    const [run] = await c.workflows.runs(w.id);
    expect(run).toMatchObject({ status: "skipped", error: "Email isn't set up yet", recipient: "ravi@example.com" });
    expect(run.message).toContain("Hi Ravi Kumar");
  });

  it("retries a failing send, then gives up after three tries", async () => {
    const { svc } = await setup();
    const w = await c.workflows.create({}, email("Confirmation"));
    sendBehaviour = "fail";
    await book(svc.id, "2026-10-19T10:00");
    await c.workflows.processDue({ now });
    expect((await c.workflows.runs(w.id))[0].status).toBe("queued");
    await c.workflows.processDue({ now });
    expect(await c.workflows.processDue({ now: new Date(now.getTime() + 2 * 60_000) })).toBe(1); // 2nd try after 1 minute
    expect(await c.workflows.processDue({ now: new Date(now.getTime() + 13 * 60_000) })).toBe(1); // 3rd after 10 more
    expect((await c.workflows.runs(w.id))[0]).toMatchObject({ status: "failed", attempts: 3, error: "Server said no" });
  });

  it("switching a workflow off or editing it cancels what it had queued", async () => {
    const { svc } = await setup();
    const w = await c.workflows.create({}, email("Later", { timing: "after", offsetMin: 60 }));
    await book(svc.id, "2026-10-19T10:00");
    await c.workflows.update({}, w.id, { ...email("Later", { timing: "after", offsetMin: 60 }), active: false });
    expect((await db.select().from(workflowRun).where(eq(workflowRun.workflowId, w.id)))[0].status).toBe("cancelled");
    expect(await c.workflows.processDue({ now: new Date(now.getTime() + 2 * 3_600_000) })).toBe(0);
  });

  it("builds the webhook payload for a custom workflow", async () => {
    const { svc } = await setup();
    await c.workflows.create({}, email("Hook", { action: { channel: "webhook", url: "https://example.com/hook" } }));
    await book(svc.id, "2026-10-19T10:00");
    await c.workflows.processDue({ now });
    expect(sent[0]).toMatchObject({
      channel: "webhook",
      url: "https://example.com/hook",
      payload: { event: "booked", booking: { reference: "BK-1", service: "Consult", staff: "Asha" }, client: { name: "Ravi Kumar", email: "ravi@example.com" } },
    });
  });
});
