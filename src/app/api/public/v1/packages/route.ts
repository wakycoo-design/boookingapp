import { app } from "@/features/container";
import { publicPreflight, publicRoute } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** GET /api/public/v1/packages: packages on sale, to show. Buying one still needs a payment, so it goes through the keyed API. */
export const GET = publicRoute("read", 120, 60_000, () => app().packages.onSale());

export const OPTIONS = publicPreflight;
