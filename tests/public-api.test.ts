import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { c, reset } from "./helpers";
import { GET as getStaff, OPTIONS as preflight } from "@/app/api/public/v1/staff/route";
import { GET as getAvailability } from "@/app/api/public/v1/availability/route";
import { GET as getPackages } from "@/app/api/public/v1/packages/route";
import { POST as postBooking } from "@/app/api/public/v1/bookings/route";
import { publicOrigins } from "@/lib/public-api";
import { zonedToUtc } from "@/lib/time";

const SITE = "https://thewaky.com";
let visitor = 0;

beforeAll(() => {
  process.env.PUBLIC_API_ORIGINS = `${SITE}, http://localhost:8731`;
});
afterAll(() => {
  delete process.env.PUBLIC_API_ORIGINS;
});
beforeEach(reset);

// A new visitor address per request keeps the per-visitor limits from leaking between tests.
const call = (method: string, path: string, opts: { origin?: string | null; body?: unknown; idem?: string; ip?: string } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      ...(opts.origin === null ? {} : { origin: opts.origin ?? SITE }),
      "x-forwarded-for": opts.ip ?? `10.0.0.${++visitor}`,
      "content-type": "application/json",
      ...(opts.idem ? { "idempotency-key": opts.idem } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

const nextWeek = (time: string) =>
  zonedToUtc(`${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)}T${time}`, "Asia/Kolkata").toISOString();
const ravi = { name: "Ravi Kumar", phone: "98765 43210" };

async function setup() {
  const svc = await c.catalog.create({}, { name: "Consultation", durationMin: 60, priceDisplay: "2500" });
  const ameen = await c.staff.create({}, { name: "Ameen Sha PK", email: "ameen@firm.test" });
  await c.staff.setServices({}, ameen.id, [svc.id]);
  await c.schedules.setWeeklyHours({}, ameen.id, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));
  return { svc, ameen };
}

describe("public website API", () => {
  it("is off unless PUBLIC_API_ORIGINS lists the site", () => {
    expect(publicOrigins({})).toEqual([]);
    expect(publicOrigins({ PUBLIC_API_ORIGINS: "https://a.com/, https://b.com" })).toEqual(["https://a.com", "https://b.com"]);
  });

  it("refuses other sites and requests with no origin", async () => {
    const { svc } = await setup();
    expect((await getStaff(call("GET", `/api/public/v1/staff?service=${svc.id}`, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await getStaff(call("GET", `/api/public/v1/staff?service=${svc.id}`, { origin: null }))).status).toBe(403);
    expect((await preflight(call("OPTIONS", "/api/public/v1/staff", { origin: "https://evil.test" }))).status).toBe(403);
  });

  it("answers the preflight and lists staff with CORS headers, without emails", async () => {
    const { svc, ameen } = await setup();
    const pre = await preflight(call("OPTIONS", "/api/public/v1/staff"));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(SITE);
    const res = await getStaff(call("GET", `/api/public/v1/staff?service=${svc.id}`));
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    const { data } = await res.json();
    expect(data).toEqual([expect.objectContaining({ id: ameen.id, name: "Ameen Sha PK" })]);
    expect(JSON.stringify(data)).not.toContain("ameen@firm.test");
  });

  it("shows free times and packages", async () => {
    const { svc, ameen } = await setup();
    await c.packages.create({}, { name: "4 sessions", serviceIds: [svc.id], sessions: 4, pricePaise: 900000 });
    const from = new Date(Date.now() + 86_400_000).toISOString();
    const to = new Date(Date.now() + 8 * 86_400_000).toISOString();
    const q = new URLSearchParams({ serviceId: svc.id, staffId: ameen.id, from, to });
    const avail = await (await getAvailability(call("GET", `/api/public/v1/availability?${q}`))).json();
    expect(avail.data.timezone).toBe("Asia/Kolkata");
    expect(avail.data.slots.length).toBeGreaterThan(0);
    const pkgs = await (await getPackages(call("GET", "/api/public/v1/packages"))).json();
    expect(pkgs.data).toEqual([expect.objectContaining({ name: "4 sessions", pricePaise: 900000 })]);
  });

  it("books once per idempotency key and returns a manage link", async () => {
    const { svc, ameen } = await setup();
    const body = { serviceId: svc.id, staffId: ameen.id, start: nextWeek("10:00"), client: ravi };
    const first = await postBooking(call("POST", "/api/public/v1/bookings", { body, idem: "idem-public-1" }));
    expect(first.status).toBe(201);
    const { data } = await first.json();
    expect(data.booking).toMatchObject({ staffName: "Ameen Sha PK", status: "upcoming" });
    expect(data.manageUrl).toMatch(new RegExp(`/manage/${data.booking.id}\\?t=`));
    const again = await postBooking(call("POST", "/api/public/v1/bookings", { body, idem: "idem-public-1" }));
    expect(again.status).toBe(200);
    expect(await c.bookings.list({ view: "all" })).toHaveLength(1);
  });

  it("takes the idempotency key from a plain-text body, so browsers need no preflight", async () => {
    const { svc, ameen } = await setup();
    const body = { serviceId: svc.id, staffId: ameen.id, start: nextWeek("15:00"), client: ravi, idempotencyKey: "idem-body-key-1" };
    const req = () =>
      new NextRequest("http://localhost/api/public/v1/bookings", {
        method: "POST",
        headers: { origin: SITE, "x-forwarded-for": `10.1.0.${++visitor}`, "content-type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(body),
      });
    expect((await postBooking(req())).status).toBe(201);
    expect((await postBooking(req())).status).toBe(200);
    expect(await c.bookings.list({ view: "all" })).toHaveLength(1);
  });

  it("needs an idempotency key and refuses a package purchase", async () => {
    const { svc, ameen } = await setup();
    const body = { serviceId: svc.id, staffId: ameen.id, start: nextWeek("11:00"), client: ravi };
    expect((await postBooking(call("POST", "/api/public/v1/bookings", { body }))).status).toBe(400);
    const withPurchase = { ...body, purchase: { packageId: "x", amountPaise: 1, razorpayPaymentId: "pay_x" } };
    expect((await postBooking(call("POST", "/api/public/v1/bookings", { body: withPurchase, idem: "idem-public-2" }))).status).toBe(400);
  });

  it("refuses a priced booking while online payment is on, like /book", async () => {
    const { svc, ameen } = await setup();
    await c.settings.update({}, { ...(await c.settings.get()), onlinePayment: true, resumeUrl: "https://thewaky.com/consultation.html" });
    const body = { serviceId: svc.id, staffId: ameen.id, start: nextWeek("12:00"), client: ravi };
    expect((await postBooking(call("POST", "/api/public/v1/bookings", { body, idem: "idem-public-3" }))).status).toBe(403);
  });

  it("limits each visitor to 8 bookings in 10 minutes", async () => {
    const { svc, ameen } = await setup();
    const ip = "10.9.9.9";
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) {
      const body = { serviceId: svc.id, staffId: ameen.id, start: nextWeek(`${String(9 + (i % 8)).padStart(2, "0")}:00`), client: ravi };
      codes.push((await postBooking(call("POST", "/api/public/v1/bookings", { body, idem: `idem-limit-${i}x`, ip }))).status);
    }
    expect(codes.at(-1)).toBe(429);
  });
});
