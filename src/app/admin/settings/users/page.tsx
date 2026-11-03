import Link from "next/link";
import { app } from "@/features/container";
import type { StaffDTO } from "@/features/staff/staff.dto";
import { dateLabel } from "@/lib/format";
import { requireStaff } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import {
  deactivateUserAction,
  reactivateUserAction,
  reinstateUserAction,
  sendResetLinkAction,
  setUserPasswordAction,
  signOutEverywhereAction,
  terminateUserAction,
} from "./actions";

export const dynamic = "force-dynamic";

function Status({ m }: { m: StaffDTO }) {
  if (m.terminatedAt) return <span className="badge border-red-300 bg-red-50 text-red-700">Terminated</span>;
  if (!m.active) return <span className="badge border-zinc-300 text-zinc-600">Inactive</span>;
  return <span className="badge border-green-300 text-green-700">Active</span>;
}

export default async function UserManagementPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const me = await requireStaff("admin");
  const { error, ok } = await searchParams;
  const [people, s] = await Promise.all([app().staff.list(), app().settings.get()]);
  const upcoming = new Map(await Promise.all(people.filter((p) => !p.terminatedAt).map(async (p) => [p.id, await app().staff.upcomingBookingCount(p.id)] as const)));

  return (
    <>
      <PageHeader title="User management" subtitle="Reset passwords, sign people out, and switch off or end someone's access. Only admins see this page." />
      <Notice error={error} ok={ok} />
      <ul className="card divide-y divide-zinc-200">
        {people.map((m) => {
          const self = m.id === me.id;
          const bookings = upcoming.get(m.id) ?? 0;
          return (
            <li key={m.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    <Link className="hover:underline" href={`/admin/staff/${m.id}`}>{m.name}</Link>
                    {self && <span className="text-xs font-normal text-zinc-500">(you)</span>}
                    <Status m={m} />
                    <span className="badge capitalize">{m.role}</span>
                  </span>
                  <span className="block text-sm text-zinc-600">
                    {m.email}
                    {m.terminatedAt && ` · terminated ${dateLabel(m.terminatedAt, s.timezone)}`}
                  </span>
                </span>
                {!m.terminatedAt && (
                  <div className="flex flex-wrap gap-2">
                    <form action={signOutEverywhereAction.bind(null, m.id, m.name)}><button className="btn-ghost" type="submit">Sign out everywhere</button></form>
                    {!self && (m.active
                      ? <form action={deactivateUserAction.bind(null, m.id, m.name)}><button className="btn-ghost" type="submit">Deactivate</button></form>
                      : <form action={reactivateUserAction.bind(null, m.id, m.name)}><button className="btn-success" type="submit">Reactivate</button></form>)}
                  </div>
                )}
                {m.terminatedAt && <form action={reinstateUserAction.bind(null, m.id, m.name)}><button className="btn-ghost" type="submit">Reinstate</button></form>}
              </div>

              {!m.terminatedAt && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-zinc-600 hover:text-black">Password{!self && " and termination"}</summary>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div className="grid content-start gap-2">
                      <p className="font-medium">Reset password</p>
                      <form action={sendResetLinkAction.bind(null, m.email, m.name)}>
                        <button className="btn-ghost" type="submit">Email them a reset link</button>
                      </form>
                      <form action={setUserPasswordAction.bind(null, m.id, m.name)} className="flex flex-wrap gap-2">
                        <label className="sr-only" htmlFor={`pw-${m.id}`}>New password for {m.name}</label>
                        <input className="input w-56" id={`pw-${m.id}`} name="password" type="password" minLength={8} maxLength={200} required autoComplete="new-password" placeholder="Or set a temporary password" />
                        <button className="btn-ghost" type="submit">Set password</button>
                      </form>
                      <p className="text-xs text-zinc-500">Setting a password signs them out on their other devices.</p>
                    </div>
                    {!self && (
                      <form action={terminateUserAction.bind(null, m.id, m.name)} className="grid content-start gap-2 rounded-lg border border-red-200 p-3">
                        <p className="font-medium text-red-700">Terminate</p>
                        <p className="text-xs text-zinc-600">For someone who has left. Signs them out everywhere, removes their password and takes them off every service. Their past bookings and notes stay.</p>
                        {bookings > 0 && <p className="text-xs font-medium text-red-700">They still have {bookings} upcoming {bookings === 1 ? "session" : "sessions"}; move or cancel {bookings === 1 ? "it" : "them"} from Bookings.</p>}
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" required /> I understand {m.name} loses all access</label>
                        <button className="btn-danger justify-self-start" type="submit">Terminate {m.name}</button>
                      </form>
                    )}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
