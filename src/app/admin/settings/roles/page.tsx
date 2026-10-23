import Link from "next/link";
import { app } from "@/features/container";
import { FEATURES, type Action } from "@/features/access/features";
import { can, requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { createRoleAction, deleteRoleAction, renameRoleAction, saveRolePermissionsAction } from "./actions";

export const dynamic = "force-dynamic";

const COLUMNS: { action: Action; label: string }[] = [
  { action: "view", label: "View" },
  { action: "viewAll", label: "Everyone's" },
  { action: "add", label: "Add" },
  { action: "edit", label: "Edit" },
  { action: "delete", label: "Delete" },
  { action: "export", label: "Export" },
];

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ role?: string; error?: string; ok?: string }> }) {
  const me = await requirePermission("settings.roles", "view");
  const editable = can(me.permissions, "settings.roles", "edit");
  const { role: wanted, error, ok } = await searchParams;
  const roles = await app().access.roles();
  const current = roles.find((r) => r.id === wanted) ?? roles.find((r) => r.system && r.base === "staff") ?? roles[0];
  const { matrix } = await app().access.matrix(current.id);
  const locked = current.base === "admin" || !editable;
  const groups = [...new Set(FEATURES.map((f) => f.group))];
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="What each role may see and do. New features appear here by themselves, with sensible defaults." />
      <Notice error={error} ok={ok} />

      <div className="mb-6 flex flex-wrap items-center gap-2" role="tablist" aria-label="Roles">
        {roles.map((r) => (
          <Link key={r.id} href={`?role=${r.id}`} className={`tab ${r.id === current.id ? "tab-active" : ""}`} aria-current={r.id === current.id ? "page" : undefined}>
            {r.name}
            <span className="ml-1.5 text-xs text-zinc-500">{r.staffCount}</span>
          </Link>
        ))}
      </div>

      <form action={saveRolePermissionsAction.bind(null, current.id)} className="grid gap-4">
        {current.base === "admin" && <p className="text-sm text-zinc-600">Admins can always do everything, so nobody can lock the firm out. Only admins can add or change admins.</p>}
        {!current.system && <p className="text-sm text-zinc-600">Started from the {current.base === "manager" ? "Manager" : "Staff"} role: anything you haven&apos;t changed follows its defaults, including features added later.</p>}
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left">
                <th className="px-4 py-3 font-medium">Feature</th>
                {COLUMNS.map((c) => <th key={c.action} className="px-3 py-3 text-center font-medium">{c.label}</th>)}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr><th colSpan={COLUMNS.length + 1} className="bg-zinc-50 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">{g}</th></tr>
                {FEATURES.filter((f) => f.group === g).map((f) => (
                  <tr key={f.key} className="border-t border-zinc-100">
                    <td className="px-4 py-3">
                      <span className="font-medium">{f.label}</span>
                      {f.hint && <span className="block text-xs text-zinc-600">{f.hint}</span>}
                    </td>
                    {COLUMNS.map((c) => {
                      const cell = matrix[f.key]?.[c.action];
                      return (
                        <td key={c.action} className="px-3 py-3 text-center">
                          {cell ? (
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" name={`p:${f.key}:${c.action}`} defaultChecked={cell.allowed} disabled={locked} aria-label={`${f.label}: ${c.label}`} />
                              {cell.changed && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Changed from the default" />}
                            </label>
                          ) : (
                            <span className="text-zinc-300" aria-hidden="true">–</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="text-xs text-zinc-600">&ldquo;Everyone&apos;s&rdquo; lets them see other people&apos;s bookings, calendars, availability, clients and reports; without it they see only their own. An amber dot marks a tick changed from the default.</p>
        {!locked && <div><button className="btn" type="submit">Save permissions</button></div>}
      </form>

      {editable && (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="card grid gap-3 p-6">
            <h2 className="font-semibold">Add a role</h2>
            <form action={createRoleAction} className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" placeholder="Receptionist" required maxLength={60} /></div>
              <div>
                <label className="label" htmlFor="copyFrom">Start as a copy of</label>
                <select className="input" id="copyFrom" name="copyFrom" defaultValue={current.base === "admin" ? roles.find((r) => r.system && r.base === "staff")?.id : current.id}>
                  {roles.filter((r) => r.base !== "admin").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2"><button className="btn-ghost" type="submit">Add role</button></div>
            </form>
          </section>
          {!current.system && (
            <section className="card grid gap-3 p-6">
              <h2 className="font-semibold">{current.name}</h2>
              <form action={renameRoleAction.bind(null, current.id)} className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1"><label className="label" htmlFor="rename">Name</label><input className="input" id="rename" name="name" defaultValue={current.name} required maxLength={60} /></div>
                <button className="btn-ghost" type="submit">Rename</button>
              </form>
              <form action={deleteRoleAction.bind(null, current.id)} className="flex flex-wrap items-center gap-3">
                <button className="btn-ghost text-red-700" type="submit">Delete role</button>
                <span className="text-xs text-zinc-600">Only when nobody has it ({current.staffCount} now).</span>
              </form>
            </section>
          )}
        </div>
      )}
    </>
  );
}
