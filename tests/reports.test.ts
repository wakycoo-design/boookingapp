import { beforeEach, describe, expect, it } from "vitest";
import { c, reset } from "./helpers";
import { csvCell } from "@/features/reports/csv";
import type { BookingActor } from "@/features/bookings/bookings.service";
import { zonedToUtc } from "@/lib/time";

beforeEach(reset);

const at = (local: string) => zonedToUtc(local, "Asia/Kolkata");
const now = at("2026-10-15T08:00");
const desk: BookingActor = { mode: "staff" };
const everyDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" }));

describe("csv", () => {
  it("quotes cells and defuses spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+91 98765 43210")).toBe("+91 98765 43210");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("-1+cmd")).toBe("'-1+cmd");
    expect(csvCell(null)).toBe("");
    expect(csvCell("plain")).toBe("plain");
  });
});

describe("reports", () => {
  async function seed() {
    const svc = await c.catalog.create({}, { name: "Consult", durationMin: 30 });
    const s = await c.staff.create({}, { name: "Asha", email: "asha@firm.test" });
    await c.staff.setServices({}, s.id, [svc.id]);
    await c.schedules.setWeeklyHours({}, s.id, everyDay);
    const book = (start: string, phone: string) => c.bookings.create(desk, { serviceId: svc.id, start: at(start), client: { name: "C " + phone, phone, email: `${phone.replace(/\D/g, "")}@x.test` } }, { now }).then((r) => r.booking);
    return { svc, book };
  }

  it("counts bookings by status, payment and who missed the visit", async () => {
    const { book } = await seed();
    const a = await book("2026-10-19T10:00", "98765 00001");
    const b = await book("2026-10-19T11:00", "98765 00002");
    const d = await book("2026-10-20T10:00", "98765 00003");
    await book("2026-10-21T10:00", "98765 00004");
    const later = { now: at("2026-10-22T09:00") };
    await c.bookings.markStatus(desk, a.id, "completed", later);
    await c.bookings.markStatus(desk, b.id, "no_show", { ...later, noShowBy: "client" });
    await c.bookings.cancel(desk, d.id, {}, { now });
    await c.bookings.setPayment({}, a.id, "paid");
    const r = await c.reports.summary({ from: "2026-10-19", to: "2026-10-21" }, at("2026-10-22T09:00"));
    expect(r.totals).toMatchObject({ total: 4, completed: 1, noShow: 1, cancelled: 1, scheduled: 1, noShowByClient: 1, noShowByStaff: 0, paid: 1, paymentPending: 0, online: 0 });
    expect(r.byService).toHaveLength(1);
    expect(r.byStaff[0]).toMatchObject({ name: "Asha", total: 4 });
    // Cancelled bookings don't count towards how busy a day was, and quiet days appear as zero.
    expect(r.perDay).toEqual([{ date: "2026-10-19", count: 2 }, { date: "2026-10-20", count: 0 }, { date: "2026-10-21", count: 1 }]);
  });

  it("counts a late-evening booking on the firm's local day, not the UTC day", async () => {
    const svc = await c.catalog.create({}, { name: "Late", durationMin: 30 });
    const s = await c.staff.create({}, { name: "Asha", email: "asha@firm.test" });
    await c.staff.setServices({}, s.id, [svc.id]);
    await c.schedules.setWeeklyHours({}, s.id, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "20:00", endTime: "23:30" })));
    await c.bookings.create(desk, { serviceId: svc.id, start: at("2026-10-19T23:00"), client: { name: "C", phone: "98765 00001" } }, { now });
    const r = await c.reports.summary({ from: "2026-10-19", to: "2026-10-19" }, now);
    expect(r.perDay).toEqual([{ date: "2026-10-19", count: 1 }]);
  });

  it("exports bookings with readable columns", async () => {
    const { book } = await seed();
    await book("2026-10-19T10:00", "98765 00001");
    const { csv, filename } = await c.reports.bookingsCsv({ from: "2026-10-19", to: "2026-10-19" }, now);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(filename).toBe("bookings-2026-10-19-to-2026-10-19.csv");
    expect(lines[0]).toBe("Booking ID,Starts,Ends,Service,Staff,Client,Phone,Email,Meeting status,Payment,Amount due (INR),Amount paid (INR),Razorpay payment ID,Paid at,No-show by,Booked,Notes,Answers");
    expect(lines[1]).toContain("BK-1,2026-10-19 10:00");
    expect(lines[1]).toContain("scheduled,not_required");
  });

  it("clamps a backwards or huge range", async () => {
    const r = await c.reports.range({ from: "2026-12-31", to: "2026-10-01" }, now);
    expect(r.from).toBe("2026-10-01");
    const big = await c.reports.range({ from: "2000-01-01", to: "2026-10-01" }, now);
    expect(big.from).toBe("2025-09-30");
  });
});
