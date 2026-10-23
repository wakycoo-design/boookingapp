import Link from "next/link";
import { app } from "@/features/container";
import type { RunStatus } from "@/features/workflows/workflows.dto";
import { toWorkflowInput } from "@/features/workflows/workflows.schemas";
import { requirePermission } from "@/lib/session";
import { bookingReference } from "@/features/bookings/bookings.dto";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { WorkflowForm } from "@/components/WorkflowForm";
import { deleteWorkflowAction, saveWorkflowAction } from "../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<RunStatus, { label: string; tone: string }> = {
  queued: { label: "Waiting", tone: "text-black" },
  sent: { label: "Sent", tone: "border-green-600/40 text-green-700" },
  failed: { label: "Failed", tone: "border-red-600/40 text-red-700" },
  skipped: { label: "Not sent", tone: "text-zinc-600" },
  cancelled: { label: "Cancelled", tone: "text-zinc-600" },
};

export default async function WorkflowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requirePermission("workflows", "edit");
  const [{ id }, { error, ok }] = await Promise.all([params, searchParams]);
  const { workflows, catalog, settings } = app();
  const [w, runs, services, s] = await Promise.all([workflows.get(id), workflows.runs(id, 50), catalog.list(), settings.get()]);
  const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <PageHeader title={w.name} action={<Link className="btn-ghost" href="/admin/workflows">All workflows</Link>} />
      <Notice error={error} ok={ok} />
      <WorkflowForm
        initial={toWorkflowInput(w)}
        services={services.filter((x) => x.active || w.serviceIds.includes(x.id)).map((x) => ({ id: x.id, name: x.name }))}
        action={saveWorkflowAction.bind(null, w.id)}
        submitLabel="Save changes"
      />

      <section className="mt-10 max-w-5xl">
        <h2 className="mb-3 font-semibold">Recent messages</h2>
        {!runs.length && <p className="card p-6 text-sm text-zinc-600">Nothing yet. Messages appear here when a booking matches this workflow.</p>}
        {runs.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead><tr><th>Due</th><th>Booking</th><th>To</th><th>Status</th><th>Message</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap text-zinc-600">{when(r.scheduledFor)}</td>
                    <td><Link className="hover:underline" href={`/admin/bookings/${r.bookingId}`}>{bookingReference(s.bookingPrefix, r.bookingNumber)}</Link></td>
                    <td className="max-w-48 truncate text-zinc-600">{r.recipient ?? "–"}</td>
                    <td>
                      <span className={`badge ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
                      {r.error && <p className="mt-1 max-w-56 text-xs text-red-700">{r.error}</p>}
                    </td>
                    <td className="max-w-md">
                      {r.message ? (
                        <details><summary className="cursor-pointer text-zinc-600">View</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{r.message}</pre></details>
                      ) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form action={deleteWorkflowAction.bind(null, w.id)} className="mt-10 max-w-3xl border-t border-zinc-200 pt-6">
        <button className="btn-danger" type="submit">Delete this workflow</button>
        <p className="mt-2 text-xs text-zinc-600">Its message history is deleted too. To pause it instead, switch it off.</p>
      </form>
    </>
  );
}
