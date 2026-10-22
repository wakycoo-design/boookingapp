import { z } from "zod";
import { app } from "@/features/container";
import { publicPreflight, publicRoute } from "@/lib/public-api";

export const dynamic = "force-dynamic";

const query = z.object({ service: z.string().uuid() });

/** GET /api/public/v1/staff?service=<id>: who offers a service and at what price. Names only, no emails. */
export const GET = publicRoute("read", 120, 60_000, async (req) => {
  const { service } = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const svc = await app().catalog.get(service);
  if (!svc.active) return [];
  return app().staff.listBookableForService(service);
});

export const OPTIONS = publicPreflight;
