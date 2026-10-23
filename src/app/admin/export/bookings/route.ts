import { app } from "@/features/container";
import { requirePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Bookings in a date range as a spreadsheet file. Managers and admins only. */
export async function GET(req: Request) {
  await requirePermission("bookings", "export");
  const q = new URL(req.url).searchParams;
  const { csv, filename } = await app().reports.bookingsCsv({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
}
