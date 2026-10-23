import { beforeEach, describe, expect, it } from "vitest";
import { c, reset } from "./helpers";
import { zonedToUtc } from "@/lib/time";

beforeEach(reset);

const nextWeek = (time: string) =>
  zonedToUtc(`${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}T${time}`, "Asia/Kolkata").toISOString();

async function team() {
  const svc = await c.catalog.create({}, { name: "Consult", durationMin: 60, priceDisplay: "1000" });
  const asha = await c.staff.create({}, { name: "Asha", email: "asha@firm.test", role: "staff" });
  const omar = await c.staff.create({}, { name: "Omar", email: "omar@firm.test", role: "staff" });
  const mona = await c.staff.create({}, { name: "Mona", email: "mona@firm.test", role: "manager" });
  for (const s of [asha, omar]) {
    await c.staff.setServices({}, s.id, [svc.id]);
    await c.schedules.setWeeklyHours({}, s.id, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));
  }
  return { svc, asha, omar, mona };
}

const titles = async (staffId: string) => (await c.inbox.list(staffId)).map((n) => n.title);

describe("in-app notifications", () => {
  it("tell the therapist and managers about a new appointment, not other therapists", async () => {
    const { svc, asha, omar, mona } = await team();
    await c.bookings.create({ mode: "staff" }, { serviceId: svc.id, staffId: asha.id, start: nextWeek("10:00"), client: { name: "Ravi", phone: "98765 43210" } });
    expect(await titles(asha.id)).toEqual(["New appointment: Ravi with Asha"]);
    expect(await titles(mona.id)).toEqual(["New appointment: Ravi with Asha"]);
    expect(await titles(omar.id)).toEqual([]);
    expect((await c.inbox.list(asha.id))[0]).toMatchObject({ href: expect.stringMatching(/^\/admin\/bookings\//) });
  });

  it("tell about cancellations, and nothing for a switched-off event", async () => {
    const { svc, asha, mona } = await team();
    const { booking } = await c.bookings.create({ mode: "staff" }, { serviceId: svc.id, staffId: asha.id, start: nextWeek("11:00"), client: { name: "Ravi", phone: "98765 43210" } });
    await c.settings.updatePart({}, { inAppEvents: ["appointment.cancelled"] });
    await c.bookings.cancel({ mode: "staff" }, booking.id, {});
    expect(await titles(mona.id)).toEqual(["Cancelled: Ravi with Asha", "New appointment: Ravi with Asha"]);
    await c.settings.updatePart({}, { inAppEvents: [] });
    expect(await c.inbox.notify({ event: "staff.created", title: "x" })).toBe(0);
  });

  it("skip the person who made the change, and follow the role's permissions", async () => {
    const { asha, mona } = await team();
    expect(await c.inbox.notify({ event: "staff.on_leave", title: "Asha is on leave", ownerId: asha.id, actorId: mona.id })).toBe(1);
    expect(await titles(asha.id)).toEqual(["Asha is on leave"]);
    expect(await titles(mona.id)).toEqual([]);
    // Staff without Notifications · view get nothing, even about themselves.
    const staffRole = (await c.access.systemRole("staff"))!;
    await c.access.saveMatrix({}, staffRole.id, ["bookings:view"]);
    expect(await c.inbox.notify({ event: "staff.on_leave", title: "Again", ownerId: asha.id })).toBe(1); // only Mona
  });

  it("count unread, open one, and mark all read", async () => {
    const { asha } = await team();
    await c.inbox.notify({ event: "staff.on_leave", title: "One", href: "/admin/staff", ownerId: asha.id });
    await c.inbox.notify({ event: "staff.on_leave", title: "Two", ownerId: asha.id });
    expect(await c.inbox.unread(asha.id)).toBe(2);
    const [two] = await c.inbox.list(asha.id);
    expect(await c.inbox.open(asha.id, two.id)).toBeNull();
    expect(await c.inbox.unread(asha.id)).toBe(1);
    await c.inbox.readAll(asha.id);
    expect(await c.inbox.unread(asha.id)).toBe(0);
    const { omar } = { omar: (await c.staff.list()).find((s) => s.name === "Omar")! };
    await expect(c.inbox.open(omar.id, two.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("only accept known events in settings", async () => {
    await expect(c.settings.updatePart({}, { inAppEvents: ["made.up"] })).rejects.toThrow();
  });
});
