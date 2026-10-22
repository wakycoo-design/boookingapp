import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { c, db, reset } from "./helpers";
import { booking, client } from "@/db/schema";
import type { BookingActor } from "@/features/bookings/bookings.service";
import { zonedToUtc } from "@/lib/time";

beforeEach(reset);

const IST = "Asia/Kolkata";
const at = (local: string) => zonedToUtc(local, IST);
const now = at("2026-10-15T08:00");
const website: BookingActor = { mode: "client", apiKeyId: undefined };
const desk: BookingActor = { mode: "staff" };
const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }));
const asha = { name: "Ravi Kumar", phone: "98765 43210" };

async function setup({ staffCount = 1, durationMin = 30, buffers = 0 } = {}) {
  const svc = await c.catalog.create({}, { name: "Consult", durationMin, bufferBeforeMin: buffers, bufferAfterMin: buffers });
  const staff = [];
  for (let i = 0; i < staffCount; i++) {
    const s = await c.staff.create({}, { name: `Staff ${i}`, email: `s${i}@firm.test` });
    await c.staff.setServices({}, s.id, [svc.id]);
    await c.schedules.setWeeklyHours({}, s.id, everyDay);
    staff.push(s);
  }
  return { svc, staff };
}

const starts = async (serviceId: string, day = "2026-10-19", staffId?: string) => {
  const { slots } = await c.availability.slots(
    { serviceId, staffId, from: at(`${day}T00:00`), to: at(`${day}T23:59`) },
    { now, mode: "client" },
  );
  return slots.map((s) => s.start.toISOString());
};

describe("availability", () => {
  it("lists free starts in the staff member's time zone", async () => {
    const { svc } = await setup();
    const s = await starts(svc.id);
    expect(s[0]).toBe(at("2026-10-19T09:00").toISOString());
    expect(s).toHaveLength(16); // 09:00 to 16:30 every 30 minutes, the default (30-minute service ends by 17:00)
  });

  it("removes booked time, time off and other people's holds", async () => {
    const { svc, staff } = await setup();
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    await c.schedules.addTimeOff({}, staff[0].id, { startsAt: at("2026-10-19T12:00"), endsAt: at("2026-10-19T13:00") });
    await c.bookings.hold(website, { serviceId: svc.id, start: at("2026-10-19T15:00") }, { now });
    const s = await starts(svc.id);
    for (const t of ["09:45", "10:00", "10:15", "11:45", "12:00", "12:45", "14:45", "15:00", "15:15"]) {
      expect(s, t).not.toContain(at(`2026-10-19T${t}`).toISOString());
    }
    expect(s).toContain(at("2026-10-19T09:30").toISOString());
    expect(s).toContain(at("2026-10-19T13:00").toISOString());
  });

  it("uses date overrides", async () => {
    const { svc, staff } = await setup();
    await c.schedules.setDateOverride({}, staff[0].id, { date: "2026-10-19", ranges: [{ startTime: "18:00", endTime: "19:00" }] });
    await c.schedules.setDateOverride({}, staff[0].id, { date: "2026-10-20", ranges: [] });
    expect(await starts(svc.id)).toEqual(["18:00", "18:30"].map((t) => at(`2026-10-19T${t}`).toISOString()));
    expect(await starts(svc.id, "2026-10-20")).toEqual([]);
    expect(await c.schedules.dateOverrides(staff[0].id, "2026-10-01", "2026-10-31")).toEqual([
      { date: "2026-10-19", ranges: [{ startTime: "18:00", endTime: "19:00" }] },
      { date: "2026-10-20", ranges: [] },
    ]);
  });

  it("applies minimum notice for the website but not for staff", async () => {
    const { svc } = await setup();
    const today = { serviceId: svc.id, from: at("2026-10-15T00:00"), to: at("2026-10-15T23:59") };
    const client = await c.availability.slots(today, { now: at("2026-10-15T10:00"), mode: "client" });
    const staff = await c.availability.slots(today, { now: at("2026-10-15T10:00"), mode: "staff" });
    expect(client.slots[0].start).toEqual(at("2026-10-15T11:00")); // 60-minute default notice
    expect(staff.slots[0].start).toEqual(at("2026-10-15T10:00"));
  });
});

describe("creating bookings", () => {
  it("books, saves the client by phone, and returns a manage token for the website", async () => {
    const { svc, staff } = await setup();
    const r = await c.bookings.create(website, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now, idempotencyKey: "key-00000001" });
    expect(r.booking).toMatchObject({ staffId: staff[0].id, status: "upcoming", source: "web", clientPhone: "+919876543210" });
    expect(r.booking.endsAt).toEqual(at("2026-10-19T10:30"));
    expect(r.manageToken).toBeTruthy();
    await c.bookings.verifyManageToken(r.booking.id, r.manageToken);
    await expect(c.bookings.verifyManageToken(r.booking.id, "wrong")).rejects.toMatchObject({ code: "not_found" });

    // The same person booking again is matched to the same client row.
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T11:00"), client: { ...asha, phone: "+91 98765-43210" } }, { now });
    expect(await db.select().from(client)).toHaveLength(1);
  });

  it("requires an Idempotency-Key from the website and replays retries", async () => {
    const { svc } = await setup();
    const input = { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha };
    await expect(c.bookings.create(website, input, { now })).rejects.toMatchObject({ code: "invalid" });
    const first = await c.bookings.create(website, input, { now, idempotencyKey: "retry-key-1" });
    const again = await c.bookings.create(website, input, { now, idempotencyKey: "retry-key-1" });
    expect(again).toMatchObject({ replayed: true, manageToken: null });
    expect(again.booking.id).toBe(first.booking.id);
    await expect(
      c.bookings.create(website, { ...input, start: at("2026-10-19T11:00") }, { now, idempotencyKey: "retry-key-1" }),
    ).rejects.toMatchObject({ code: "conflict", details: { reason: "idempotency_key_reused" } });
    expect(await db.select().from(booking)).toHaveLength(1);
  });

  it("refuses a taken time, a time outside hours, and the past", async () => {
    const { svc } = await setup();
    const input = { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha };
    await c.bookings.create(desk, input, { now });
    await expect(c.bookings.create(desk, { ...input, start: at("2026-10-19T10:15") }, { now })).rejects.toMatchObject({ code: "conflict" });
    await expect(c.bookings.create(desk, { ...input, start: at("2026-10-19T20:00") }, { now })).rejects.toMatchObject({ code: "conflict" });
    await expect(c.bookings.create(desk, { ...input, start: at("2026-10-14T10:00") }, { now })).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps service buffers clear", async () => {
    const { svc } = await setup({ buffers: 15 });
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    await expect(
      c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:30"), client: asha }, { now }),
    ).rejects.toMatchObject({ code: "conflict" });
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T11:00"), client: asha }, { now });
  });

  it("lets exactly one of many simultaneous requests win a slot", async () => {
    const { svc } = await setup();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        c.bookings.create(website, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: { name: `C${i}`, phone: `+9198765000${String(i).padStart(2, "0")}` } }, { now, idempotencyKey: `race-key-${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });
  });

  it("spreads 'anyone available' bookings fairly", async () => {
    const { svc, staff } = await setup({ staffCount: 2 });
    const a = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    const b = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T11:00"), client: asha }, { now });
    expect(new Set([a.booking.staffId, b.booking.staffId])).toEqual(new Set(staff.map((s) => s.id)));
  });
});

describe("holds", () => {
  it("keeps a time for the holder only, until it expires", async () => {
    const { svc } = await setup();
    const input = { serviceId: svc.id, start: at("2026-10-19T10:00") };
    const hold = await c.bookings.hold(website, input, { now });
    await expect(c.bookings.hold(website, input, { now })).rejects.toMatchObject({ code: "conflict" });
    await expect(
      c.bookings.create(website, { ...input, client: asha }, { now, idempotencyKey: "someone-else" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const r = await c.bookings.create(website, { ...input, client: asha, holdToken: hold.token }, { now, idempotencyKey: "holder-key" });
    expect(r.booking.staffId).toBe(hold.staffId);
    // The hold was used up by the booking.
    expect(await c.bookings.deleteExpiredHolds(new Date("2100-01-01"))).toBe(0);
  });

  it("ignores expired holds", async () => {
    const { svc } = await setup();
    const input = { serviceId: svc.id, start: at("2026-10-19T10:00") };
    await c.bookings.hold(website, input, { now });
    const later = new Date(now.getTime() + 6 * 60_000);
    await c.bookings.create(desk, { ...input, client: asha }, { now: later });
  });
});

describe("rescheduling and cancelling", () => {
  it("moves a booking by making a new one and cancelling the old, even when the times overlap", async () => {
    const { svc } = await setup();
    // Starts every 15 minutes, so the new time can overlap the old one.
    await c.settings.update({}, { ...(await c.settings.get()), slotIntervalMin: 15 });
    const { booking: old } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    const moved = await c.bookings.reschedule(desk, old.id, { start: at("2026-10-19T10:15") }, { now });
    expect(moved).toMatchObject({ rescheduledFromId: old.id, status: "upcoming", clientId: old.clientId });
    expect(moved.startsAt).toEqual(at("2026-10-19T10:15"));
    expect(await c.bookings.get(old.id)).toMatchObject({ status: "cancelled", cancellationReason: "Rescheduled" });
    await expect(c.bookings.reschedule(desk, old.id, { start: at("2026-10-19T12:00") }, { now })).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps a moved booking and tells it apart from a cancelled one: it points to its replacement, which points back", async () => {
    const { svc } = await setup();
    const { booking: first } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-12-01T10:00"), client: asha }, { now });
    const { booking: plain } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-12-02T10:00"), client: asha }, { now });
    const second = await c.bookings.reschedule(desk, first.id, { start: at("2026-12-03T10:00") }, { now });
    const third = await c.bookings.reschedule(desk, second.id, { start: at("2026-12-04T10:00") }, { now });
    await c.bookings.cancel(desk, plain.id, {}, { now });
    const byId = new Map((await c.bookings.list({ view: "all" })).map((b) => [b.id, b]));
    expect(byId.get(first.id)).toMatchObject({ status: "cancelled", movedToId: second.id, rescheduledFromId: null });
    expect(byId.get(second.id)).toMatchObject({ status: "cancelled", movedToId: third.id, rescheduledFromId: first.id });
    expect(byId.get(third.id)).toMatchObject({ status: "upcoming", movedToId: null, rescheduledFromId: second.id });
    // A real cancellation is not marked as moved.
    expect(byId.get(plain.id)).toMatchObject({ status: "cancelled", movedToId: null });
  });

  it("refuses to move onto a taken time and leaves the original untouched", async () => {
    const { svc } = await setup();
    const { booking: a } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T11:00"), client: asha }, { now });
    await expect(c.bookings.reschedule(desk, a.id, { start: at("2026-10-19T11:00") }, { now })).rejects.toMatchObject({ code: "conflict" });
    expect((await c.bookings.get(a.id)).status).toBe("upcoming");
  });

  it("refuses to cancel twice or after the booking ended", async () => {
    const { svc } = await setup();
    const { booking: b } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    await expect(c.bookings.cancel(desk, b.id, {}, { now: at("2026-10-19T10:30") })).rejects.toMatchObject({ code: "invalid" });
    expect(await c.bookings.cancel(desk, b.id, { reason: "Client asked" }, { now })).toMatchObject({
      status: "cancelled",
      cancellationReason: "Client asked",
      cancelledBy: "system",
    });
    await expect(c.bookings.cancel(desk, b.id, {}, { now })).rejects.toMatchObject({ details: { reason: "already_cancelled" } });
    // The freed time can be booked again.
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
  });

  it("stops clients cancelling or moving online inside the cutoff", async () => {
    const { svc } = await setup();
    const { booking: b } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-15T15:00"), client: asha }, { now });
    await expect(c.bookings.cancel(website, b.id, {}, { now })).rejects.toMatchObject({ code: "forbidden" });
    await expect(c.bookings.reschedule(website, b.id, { start: at("2026-10-19T10:00") }, { now })).rejects.toMatchObject({ code: "forbidden" });
    expect((await c.bookings.cancel(desk, b.id, {}, { now })).cancelledBy).toBe("system");
  });

  it("marks what happened once a booking has started", async () => {
    const { svc } = await setup();
    const { booking: b } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    await expect(c.bookings.markStatus(desk, b.id, "completed", { now })).rejects.toMatchObject({ code: "invalid" });
    const later = { now: at("2026-10-19T10:40") };
    await expect(c.bookings.markStatus(desk, b.id, "no_show", later)).rejects.toMatchObject({ code: "invalid" });
    const missed = await c.bookings.markStatus(desk, b.id, "no_show", { ...later, noShowBy: "staff" });
    expect(missed).toMatchObject({ status: "no_show", noShowBy: "staff" });
    expect(await c.bookings.markStatus(desk, b.id, "upcoming", later)).toMatchObject({ status: "upcoming", noShowBy: null });
  });

  it("records who missed a no-show, and forgets it when the booking is marked completed", async () => {
    const { svc } = await setup();
    const { booking: b } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    const later = { now: at("2026-10-19T10:40") };
    expect((await c.bookings.markStatus(desk, b.id, "no_show", { ...later, noShowBy: "client" })).noShowBy).toBe("client");
    expect(await c.bookings.markStatus(desk, b.id, "completed", { ...later, noShowBy: "client" })).toMatchObject({ status: "completed", noShowBy: null });
  });

  it("tracks payment status separately from the meeting status", async () => {
    const { svc } = await setup();
    const { booking: b } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T10:00"), client: asha }, { now });
    expect(b.paymentStatus).toBe("not_required"); // the service has no price
    expect((await c.bookings.setPayment({}, b.id, "paid")).paymentStatus).toBe("paid");
    expect((await c.bookings.setPayment({}, b.id, "failed")).paymentStatus).toBe("failed");
    await expect(c.bookings.setPayment({}, b.id, "refunded" as never)).rejects.toMatchObject({ code: "invalid" });
    await c.bookings.cancel(desk, b.id, {}, { now });
    expect((await c.bookings.setPayment({}, b.id, "paid")).status).toBe("cancelled");
  });

  it("lists upcoming, past and cancelled views", async () => {
    const { svc } = await setup();
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-12-01T10:00"), client: asha }, { now });
    const { booking: x } = await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-12-02T10:00"), client: asha }, { now });
    await c.bookings.cancel(desk, x.id, {}, { now });
    expect(await c.bookings.list({ view: "upcoming" })).toHaveLength(1);
    expect(await c.bookings.list({ view: "cancelled" })).toHaveLength(1);
    expect(await db.select().from(booking).where(eq(booking.status, "cancelled"))).toHaveLength(1);
  });
});
