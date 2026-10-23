import { beforeEach, describe, expect, it } from "vitest";
import { c, reset } from "./helpers";
import { bookingReference } from "@/features/bookings/bookings.dto";
import { zonedToUtc } from "@/lib/time";

beforeEach(reset);

const nextWeek = (time: string) =>
  zonedToUtc(`${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}T${time}`, "Asia/Kolkata").toISOString();

async function bookOne(time: string, phone: string) {
  const svc = (await c.catalog.list())[0] ?? (await c.catalog.create({}, { name: "Session", durationMin: 30, priceDisplay: "1000" }));
  if (!(await c.staff.list()).length) {
    const s = await c.staff.create({}, { name: "Asha", email: "asha@firm.test" });
    await c.staff.setServices({}, s.id, [svc.id]);
    await c.schedules.setWeeklyHours({}, s.id, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));
  }
  return (await c.bookings.create({ mode: "staff" }, { serviceId: svc.id, start: nextWeek(time), client: { name: "Ravi", phone } })).booking;
}

describe("settings pages", () => {
  it("save only their own fields", async () => {
    await c.settings.updatePart({}, { name: "Waky Labs", email: "Hello@Waky.Test", phone: "+91 98765 43210", weekStart: "0", timeFormat: "24h" });
    await c.settings.updatePart({}, { slotIntervalMin: "15" });
    expect(await c.settings.get()).toMatchObject({
      name: "Waky Labs", email: "hello@waky.test", phone: "+91 98765 43210", weekStart: 0, timeFormat: "24h", slotIntervalMin: 15,
    });
  });

  it("keep business hours as information, any shape of day", async () => {
    const hours = [{ weekday: 1, startTime: "09:00", endTime: "00:00" }, { weekday: 2, startTime: "08:00", endTime: "13:00" }];
    await c.settings.updatePart({}, { businessHours: hours });
    expect((await c.settings.get()).businessHours).toEqual(hours);
    await expect(c.settings.updatePart({}, { businessHours: [{ weekday: 1, startTime: "9am", endTime: "5pm" }] })).rejects.toThrow();
  });

  it("refuse a bad email", async () => {
    await expect(c.settings.updatePart({}, { email: "not-an-email" })).rejects.toThrow();
  });
});

describe("booking IDs", () => {
  it("join prefix and number with no padding", () => {
    expect(bookingReference("WZ780", 1007)).toBe("WZ7801007");
    expect(bookingReference("BK-", 9)).toBe("BK-9");
  });

  it("continue from a chosen number, old bookings keep theirs", async () => {
    const first = await bookOne("10:00", "90000 00001");
    expect(await c.bookings.nextNumber()).toBe(first.number + 1);
    await c.bookings.setNextNumber({}, 1007);
    expect(await c.bookings.nextNumber()).toBe(1007);
    const second = await bookOne("11:00", "90000 00002");
    const third = await bookOne("12:00", "90000 00003");
    expect([second.number, third.number]).toEqual([1007, 1008]);
    expect((await c.bookings.get(first.id)).number).toBe(first.number);
  });

  it("only move forward", async () => {
    await c.bookings.setNextNumber({}, 1007);
    await bookOne("10:00", "90000 00004");
    await expect(c.bookings.setNextNumber({}, 1005)).rejects.toMatchObject({ code: "invalid" });
    await expect(c.bookings.setNextNumber({}, 0)).rejects.toMatchObject({ code: "invalid" });
    await c.bookings.setNextNumber({}, 1008); // the number it is at now: nothing to do
    expect(await c.bookings.nextNumber()).toBe(1008);
  });
});
