import { app } from "@/features/container";
import { publicPreflight, publicRoute } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/public/v1/availability?serviceId=&staffId=&from=&to=: the same free times as /api/v1/availability. */
export const GET = publicRoute("read", 120, 60_000, async (req) => {
  const p = req.nextUrl.searchParams;
  const { availability, settings } = app();
  const { service, slots } = await availability.slots(
    { serviceId: p.get("serviceId") ?? "", staffId: p.get("staffId"), from: p.get("from") ?? "", to: p.get("to") ?? "" },
    { mode: "client" },
  );
  return {
    serviceId: service.id,
    durationMin: service.durationMin,
    timezone: (await settings.get()).timezone,
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), staffIds: s.staffIds })),
  };
});

export const OPTIONS = publicPreflight;
