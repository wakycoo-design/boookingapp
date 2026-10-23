import Link from "next/link";
import { app } from "@/features/container";
import { hasRole, requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { DESIGNATIONS } from "@/features/staff/staff.dto";
import { createStaffAction } from "../actions";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const me = await requirePermission("staff", "view");
  const { error, ok } = await searchParams;
  const [rows, allRoles] = await Promise.all([app().staff.list(), app().access.roles()]);
  const roles = allRoles.filter((r) => r.base !== "admin" || hasRole(me, "admin"));
  const staffRole = roles.find((r) => r.system && r.base === "staff")?.id;
  const roleName = (s: { role: string; roleId: string | null }) =>
    allRoles.find((r) => r.id === s.roleId)?.name ?? allRoles.find((r) => r.system && r.base === s.role)?.name ?? s.role;
  return (
    <>
      <PageHeader title="Staff" subtitle="People who can sign in and be booked." />
      <Notice error={error} ok={ok} />
      <div className="card mb-10 overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Designation</th><th>Role</th><th>Time zone</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="row-link">
                <td><Link className="row-link-target font-medium" href={`/admin/staff/${s.id}`}>{s.name}</Link></td>
                <td className="text-zinc-600">{s.email}</td>
                <td className="text-zinc-600">{s.designation ?? "–"}</td>
                <td>{roleName(s)}</td>
                <td className="text-zinc-600">{s.timezone}</td>
                <td><span className="badge">{s.active ? "Active" : "Inactive"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card max-w-2xl p-6">
        <h2 className="mb-1 font-semibold">Add a staff member</h2>
        <p className="mb-5 text-sm text-zinc-600">They sign in with this work email.</p>
        <form action={createStaffAction} className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" required /></div>
          <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" required /></div>
          <div>
            <label className="label" htmlFor="designation">Designation</label>
            <select className="input" id="designation" name="designation" defaultValue="">
              <option value="">Not set</option>
              {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="role">Role</label>
            <select className="input" id="role" name="roleId" defaultValue={staffRole}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="timezone">Time zone</label><TimezoneSelect /></div>
          <div className="sm:col-span-2"><button className="btn" type="submit">Add staff member</button></div>
        </form>
      </section>
    </>
  );
}
