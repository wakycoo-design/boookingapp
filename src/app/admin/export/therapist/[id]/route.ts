import { app } from "@/features/container";
import { therapistCsv } from "@/features/performance/performance.csv";
import { isDomainError } from "@/features/shared/errors";
import { can, currentPermissions, currentStaff } from "@/lib/session";

export const dynamic = "force-dynamic";

/** One therapist's sessions for a period as a spreadsheet. Managers and admins, or the therapist themselves. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentStaff();
  if (!me) return Response.json({ error: { code: "unauthorized", message: "Sign in first" } }, { status: 401 });
  const perms = await currentPermissions();
  if (!can(perms, "reports", me.id === id ? "view" : "viewAll")) return Response.json({ error: { code: "forbidden", message: "Not allowed to see this report" } }, { status: 403 });
  try {
    const detail = await app().performance.therapist({ staffId: id, period: new URL(req.url).searchParams.get("period") ?? undefined });
    const { csv, filename } = therapistCsv(detail, await app().settings.get());
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (isDomainError(err) && err.code === "not_found") return Response.json({ error: { code: "not_found", message: err.message } }, { status: 404 });
    throw err;
  }
}
