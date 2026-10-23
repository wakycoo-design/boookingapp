import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { c, reset } from "./helpers";
import { GET as getServices } from "@/app/api/v1/services/route";
import { GET as getStaffForService } from "@/app/api/v1/staff/route";

beforeEach(reset);

const req = (path: string, key?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });

describe("/api/v1", () => {
  it("requires an API key", async () => {
    const res = await getServices(req("/api/v1/services"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("lists active services only", async () => {
    const { key } = await c.apiKeys.create({ name: "Website", scopes: ["website"] });
    await c.catalog.create({}, { name: "Consult", durationMin: 30, priceDisplay: "₹1,500" });
    await c.catalog.create({}, { name: "Retired", durationMin: 30, active: false });
    const res = await getServices(req("/api/v1/services", key));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      expect.objectContaining({ name: "Consult", durationMin: 30, priceDisplay: "₹1,500" }),
    ]);
    expect(body.data[0]).not.toHaveProperty("bufferBeforeMin");
  });

  it("lists staff for a service without exposing emails", async () => {
    const { key } = await c.apiKeys.create({ name: "Website", scopes: ["website"] });
    const svc = await c.catalog.create({}, { name: "Consult", durationMin: 30 });
    const a = await c.staff.create({}, { name: "Asha", email: "asha@firm.test" });
    await c.staff.setServices({}, a.id, [svc.id]);
    const body = await (await getStaffForService(req(`/api/v1/staff?service=${svc.id}`, key))).json();
    expect(body.data).toEqual([{ id: a.id, name: "Asha", timezone: "Asia/Kolkata", pricePaise: null }]); // null: this service is free
  });

  it("returns 400 for a bad service id and 404 for an unknown one", async () => {
    const { key } = await c.apiKeys.create({ name: "Website", scopes: ["website"] });
    expect((await getStaffForService(req("/api/v1/staff?service=nope", key))).status).toBe(400);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await getStaffForService(req(`/api/v1/staff?service=${unknown}`, key))).status).toBe(404);
  });
});

describe("/api/v1 booking flow", () => {
  const post = (path: string, key: string, body: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

  it("finds a slot, holds it, books it, moves it and cancels it", async () => {
    const { GET: availability } = await import("@/app/api/v1/availability/route");
    const { POST: hold } = await import("@/app/api/v1/slot-holds/route");
    const { POST: create } = await import("@/app/api/v1/bookings/route");
    const { GET: show } = await import("@/app/api/v1/bookings/[id]/route");
    const { POST: reschedule } = await import("@/app/api/v1/bookings/[id]/reschedule/route");
    const { POST: cancel } = await import("@/app/api/v1/bookings/[id]/cancel/route");

    const { key } = await c.apiKeys.create({ name: "Website", scopes: ["website"] });
    const svc = await c.catalog.create({}, { name: "Consult", durationMin: 30 });
    const s = await c.staff.create({}, { name: "Asha", email: "asha@firm.test" });
    await c.staff.setServices({}, s.id, [svc.id]);
    await c.schedules.setWeeklyHours({}, s.id, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })));

    const from = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    const slotsRes = await availability(req(`/api/v1/availability?serviceId=${svc.id}&from=${from}&to=${to}`, key));
    expect(slotsRes.status).toBe(200);
    const { data } = await slotsRes.json();
    expect(data.timezone).toBe("Asia/Kolkata");
    const [first, second] = data.slots;

    const holdRes = await hold(post("/api/v1/slot-holds", key, { serviceId: svc.id, start: first.start }));
    expect(holdRes.status).toBe(201);
    const held = (await holdRes.json()).data;

    const body = { serviceId: svc.id, start: first.start, holdToken: held.token, client: { name: "Ravi", phone: "9876543210" } };
    expect((await create(post("/api/v1/bookings", key, body))).status).toBe(400); // no Idempotency-Key
    const created = await create(post("/api/v1/bookings", key, body, { "idempotency-key": "web-123456" }));
    expect(created.status).toBe(201);
    const { booking, manageToken } = (await created.json()).data;
    expect(booking).toMatchObject({ reference: "BK-1", staffName: "Asha", status: "upcoming" });
    expect(booking).not.toHaveProperty("clientPhone");

    const replay = await create(post("/api/v1/bookings", key, body, { "idempotency-key": "web-123456" }));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");

    const showReq = (token?: string) =>
      new NextRequest(`http://localhost/api/v1/bookings/${booking.id}`, {
        headers: { authorization: `Bearer ${key}`, ...(token ? { "x-manage-token": token } : {}) },
      });
    expect((await show(showReq(), params({ id: booking.id }))).status).toBe(404);
    expect((await show(showReq(manageToken), params({ id: booking.id }))).status).toBe(200);

    const moved = await reschedule(
      post(`/api/v1/bookings/${booking.id}/reschedule`, key, { start: second.start }, { "x-manage-token": manageToken }),
      params({ id: booking.id }),
    );
    expect(moved.status).toBe(200);
    const next = (await moved.json()).data;
    expect(next).toMatchObject({ start: second.start, rescheduledFromId: booking.id });

    const cancelled = await cancel(
      post(`/api/v1/bookings/${next.id}/cancel`, key, { reason: "Can't make it" }, { "x-manage-token": manageToken }),
      params({ id: next.id }),
    );
    expect((await cancelled.json()).data.status).toBe("cancelled");
    const again = await cancel(post(`/api/v1/bookings/${next.id}/cancel`, key, {}, { "x-manage-token": manageToken }), params({ id: next.id }));
    expect(again.status).toBe(409);
  });
});
