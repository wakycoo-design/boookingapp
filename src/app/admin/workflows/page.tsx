import Link from "next/link";
import { app } from "@/features/container";
import { CHANNEL_LABEL, KIND_LABEL, kindOf, whenLabel, type WorkflowKind } from "@/features/workflows/workflows.dto";
import { can, requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { toggleWorkflowAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; type?: string }> }) {
  const me = await requirePermission("workflows", "view");
  const { error, ok, type } = await searchParams;
  const kind: WorkflowKind = type === "system" ? "system" : "notification";
  const [all, services] = await Promise.all([app().workflows.list(), app().catalog.list()]);
  const workflows = all.filter((w) => kindOf(w.channel) === kind);
  const count = (k: WorkflowKind) => all.filter((w) => kindOf(w.channel) === k).length;
  const names = new Map(services.map((s) => [s.id, s.name]));
  const admin = can(me.permissions, "workflows", "add");
  const canEdit = can(me.permissions, "workflows", "edit");
  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle="Send emails and WhatsApp messages, or call your own system, when something happens to a booking."
        action={admin ? <Link className="btn" href={`/admin/workflows/new?kind=${kind}`}>New workflow</Link> : undefined}
      />
      <Notice error={error} ok={ok} />
      <nav className="tabs" aria-label="Kind of workflow">
        {(["notification", "system"] as const).map((k) => (
          <Link key={k} href={`/admin/workflows?type=${k}`} className={`tab ${k === kind ? "tab-active" : ""}`} aria-current={k === kind ? "page" : undefined}>
            {KIND_LABEL[k]} <span className="text-zinc-500">{count(k)}</span>
          </Link>
        ))}
      </nav>
      <p className="mb-4 text-sm text-zinc-600">
        {kind === "notification"
          ? "Emails and WhatsApp messages to clients or staff."
          : "Send each booking to your own system (CRM, sheet, billing…) as it happens."}
      </p>
      {!workflows.length && (
        <p className="card p-6 text-sm text-zinc-600">
          No {kind === "notification" ? "notification" : "system"} workflows yet.
          {admin ? (kind === "notification" ? " Start with a ready-made one: booking confirmation, reminders, a cancellation notice and more." : " Use “Custom: send to my system” to start.") : ""}
        </p>
      )}
      {workflows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>When</th><th>Action</th><th>Services</th><th>Status</th></tr></thead>
            <tbody>
              {workflows.map((w) => (
                <tr key={w.id}>
                  <td><Link className="font-medium hover:underline" href={`/admin/workflows/${w.id}`}>{w.name}</Link></td>
                  <td className="text-zinc-600">{whenLabel(w)}</td>
                  <td>{CHANNEL_LABEL[w.channel]}</td>
                  <td className="text-zinc-600">{w.serviceIds.length ? w.serviceIds.map((id) => names.get(id) ?? "Removed service").join(", ") : "All services"}</td>
                  <td>
                    {canEdit ? (
                      <form action={toggleWorkflowAction.bind(null, w.id)}>
                        <button className={`badge ${w.active ? "border-green-600/40 text-green-700" : "text-zinc-600"}`} type="submit" title={w.active ? "Click to switch off" : "Click to switch on"}>
                          {w.active ? "Active" : "Off"}
                        </button>
                      </form>
                    ) : (
                      <span className="badge">{w.active ? "Active" : "Off"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
