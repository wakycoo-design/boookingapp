import { notFound, redirect } from "next/navigation";
import { app } from "@/features/container";
import { DESIGNATIONS } from "@/features/staff/staff.dto";
import { isDomainError } from "@/features/shared/errors";
import { addDays, localDate } from "@/features/availability/slots";
import { can, currentPermissions, hasRole, requireStaff } from "@/lib/session";
import { formatInZone } from "@/lib/time";
import { longDayLabel } from "@/lib/format";
import { HoursEditor } from "@/components/HoursEditor";
import { Notice } from "@/components/Notice";
import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import {
  addTimeOffAction,
  calendarOptionsAction,
  disconnectCalendarAction,
  removeDateOverrideAction,
  removeTimeOffAction,
  setDateOverrideAction,
  setHoursAction,
  syncCalendarAction,
  updateStaffAction,
} from "../../actions";

export default async function StaffDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const me = await requireStaff();
  const perms = await currentPermissions();
  // Their own page is their availability; someone else's needs everyone's availability or the staff list.
  const allowed = me.id === id ? can(perms, "availability", "view") : can(perms, "availability", "viewAll") || can(perms, "staff", "view");
  if (!allowed) redirect("/?error=forbidden");
  const isManager = can(perms, "staff", "edit");

  const { staff, catalog, schedules } = app();
  const member = await staff.get(id).catch((err) => {
    if (isDomainError(err)) notFound();
    throw err;
  });
  const now = new Date();
  const today = localDate(now.getTime(), member.timezone);
  const [services, offered, hours, timeOff, overrides, calendar, prices] = await Promise.all([
    catalog.list(),
    staff.serviceIds(id),
    schedules.weeklyHours(id),
    schedules.timeOffBetween(id, now, new Date(now.getTime() + 365 * 86400_000)),
    schedules.dateOverrides(id, today, addDays(today, 366)),
    app().calendar.status(id),
    staff.servicePrices(id),
  ]);
  const roles = (await app().access.roles()).filter((r) => r.base !== "admin" || hasRole(me, "admin"));
  const google = calendar.connection;

  return (
    <>
      <PageHeader
        title={me.id === id ? "Availability" : member.name}
        subtitle={`Times are in ${member.timezone}.`}
        action={<Link href={`/admin/reports/therapists/${id}`} className="btn-ghost">Performance report</Link>}
      />
      <Notice error={error} ok={ok} />

      <div className="grid gap-8 xl:grid-cols-[1fr_22rem]">
        <section>
          <h2 className="mb-3 font-semibold">Weekly hours</h2>
          <form action={setHoursAction.bind(null, id)}>
            <HoursEditor initial={hours} />
            <button className="btn mt-4" type="submit">Save hours</button>
          </form>
        </section>

        <section>
          <h2 className="mb-1 font-semibold">Date overrides</h2>
          <p className="mb-3 text-sm text-zinc-600">Different hours on one date, or a day off. Replaces the weekly hours for that date.</p>
          <div className="card mb-4 divide-y divide-zinc-100">
            {overrides.length === 0 && <p className="p-4 text-sm text-zinc-600">No overrides.</p>}
            {overrides.map((o) => (
              <div key={o.date} className="flex items-center gap-3 p-4 text-sm">
                <span className="flex-1">
                  <span className="block">{longDayLabel(new Date(`${o.date}T12:00:00Z`), "UTC")}</span>
                  <span className="text-zinc-600">
                    {o.ranges.length ? o.ranges.map((r) => `${r.startTime}–${r.endTime}`).join(", ") : "Unavailable"}
                  </span>
                </span>
                <form action={removeDateOverrideAction.bind(null, id, o.date)}>
                  <button className="icon-btn" aria-label={`Remove override for ${o.date}`} type="submit">×</button>
                </form>
              </div>
            ))}
          </div>
          <form action={setDateOverrideAction.bind(null, id)} className="card grid gap-3 p-4">
            <div><label className="label" htmlFor="ov-date">Date</label><input className="input" id="ov-date" name="date" type="date" min={today} required /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label" htmlFor="start1">From</label><input className="input" id="start1" name="start1" type="time" defaultValue="10:00" /></div>
              <div><label className="label" htmlFor="end1">To</label><input className="input" id="end1" name="end1" type="time" defaultValue="14:00" /></div>
              <div><label className="label" htmlFor="start2">Then from</label><input className="input" id="start2" name="start2" type="time" /></div>
              <div><label className="label" htmlFor="end2">To</label><input className="input" id="end2" name="end2" type="time" /></div>
            </div>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="toggle" name="off" /> Unavailable all day</label>
            <div><button className="btn-ghost" type="submit">Add override</button></div>
          </form>
        </section>
      </div>

      <section className="mt-12">
        <h2 className="mb-3 font-semibold">Time off and blocked time</h2>
        {timeOff.length === 0 ? (
          <p className="mb-4 text-sm text-zinc-600">Nothing upcoming.</p>
        ) : (
          <div className="card mb-4 divide-y divide-zinc-100">
            {timeOff.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-4 text-sm">
                <span className="flex-1">
                  {formatInZone(t.startsAt, member.timezone)} to {formatInZone(t.endsAt, member.timezone)}
                  {t.reason && <span className="ml-3 text-zinc-600">{t.reason}</span>}
                </span>
                <form action={removeTimeOffAction.bind(null, id, t.id)}><button className="btn-ghost" type="submit">Remove</button></form>
              </div>
            ))}
          </div>
        )}
        <form action={addTimeOffAction.bind(null, id)} className="card grid max-w-3xl gap-4 p-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="startsAt">From</label><input className="input" id="startsAt" name="startsAt" type="datetime-local" required /></div>
          <div><label className="label" htmlFor="endsAt">To</label><input className="input" id="endsAt" name="endsAt" type="datetime-local" required /></div>
          <div><label className="label" htmlFor="reason">Reason</label><input className="input" id="reason" name="reason" placeholder="Optional" /></div>
          <div className="sm:col-span-3"><button className="btn-ghost" type="submit">Add time off</button></div>
        </form>
      </section>

      <section className="mt-12">
        <h2 className="mb-1 font-semibold">Google Calendar</h2>
        <p className="mb-3 max-w-2xl text-sm text-zinc-600">
          Bookings appear in the calendar, and anything already in it blocks those hours from being booked.
        </p>
        {!calendar.providerConfigured ? (
          <p className="card max-w-3xl p-4 text-sm text-zinc-600">
            Google Calendar is not set up on this server yet. Add GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (see docs/google-calendar.md), then restart.
          </p>
        ) : !google ? (
          <a className="btn inline-block" href={`/api/calendar/google/connect?staff=${id}`}>Connect Google Calendar</a>
        ) : (
          <div className="card grid max-w-3xl gap-4 p-4">
            <p className="text-sm">
              Connected{google.accountEmail ? <> as <strong>{google.accountEmail}</strong></> : null}
              {google.lastSyncedAt && <span className="text-zinc-600"> · busy times read {formatInZone(google.lastSyncedAt, member.timezone)}</span>}
            </p>
            {google.lastError && (
              <p className="text-sm font-medium text-red-700">
                {google.errorCount >= 5 ? "Sync stopped: " : "Last problem: "}{google.lastError}
                {google.errorCount >= 5 && " Disconnect and connect again to fix it."}
              </p>
            )}
            <form action={calendarOptionsAction.bind(null, id)} className="grid gap-3">
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="toggle" name="pushBookings" defaultChecked={google.pushBookings} /> Add my bookings to this calendar</label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="toggle mt-0.5" name="createMeetLinks" defaultChecked={google.createMeetLinks} /> <span>Create Google Meet links for my online sessions<span className="block text-zinc-600">Applies to services set to &ldquo;Online with Google Meet&rdquo; once Settings has online sessions switched on.</span></span></label>
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="toggle" name="inviteClients" defaultChecked={google.inviteClients} /> Email clients a calendar invite (needs their email; sent by Google from {google.accountEmail ?? "this calendar"})</label>
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="toggle" name="blockBusy" defaultChecked={google.blockBusy} /> Block times when I am busy in this calendar</label>
              <div><button className="btn-ghost" type="submit">Save</button></div>
            </form>
            <div className="flex gap-3">
              <form action={syncCalendarAction.bind(null, id)}><button className="btn-ghost" type="submit">Sync now</button></form>
              <form action={disconnectCalendarAction.bind(null, id)}><button className="btn-ghost" type="submit">Disconnect</button></form>
            </div>
          </div>
        )}
      </section>

      {isManager && (
        <section className="mt-12">
          <h2 className="mb-3 font-semibold">Profile</h2>
          <form action={updateStaffAction.bind(null, id)} className="card grid max-w-3xl gap-4 p-6 sm:grid-cols-2">
            <div><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" defaultValue={member.name} required /></div>
            <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" defaultValue={member.email} required /></div>
            <div>
              <label className="label" htmlFor="designation">Designation</label>
              <select className="input" id="designation" name="designation" defaultValue={member.designation ?? ""}>
                <option value="">Not set</option>
                {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="role">Role</label>
              <select className="input" id="role" name="roleId" defaultValue={member.roleId ?? roles.find((r) => r.system && r.base === member.role)?.id}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div><label className="label" htmlFor="timezone">Time zone</label><TimezoneSelect value={member.timezone} /></div>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <input type="checkbox" className="toggle" name="active" defaultChecked={member.active} /> Active (can sign in and be booked)
            </label>
            {hasRole(me, "admin") && (
              <label className="flex items-start gap-3 text-sm sm:col-span-2">
                <input type="checkbox" className="toggle mt-0.5" name="clinicalAdmin" defaultChecked={member.clinicalAdmin} />
                <span>Clinical admin <span className="block text-xs text-zinc-600">Can read and write every client&apos;s case history, not only the clients they treat.</span></span>
              </label>
            )}
            <fieldset className="sm:col-span-2">
              <legend className="label">Services they offer and their price</legend>
              <p className="mb-2 text-xs text-zinc-600">Leave the price blank to use the service&apos;s own price. A price here is what this person charges.</p>
              {services.length === 0 && <p className="text-sm text-zinc-600">No services yet.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {services.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <label className="flex flex-1 items-center gap-2">
                      <input type="checkbox" name="serviceIds" value={s.id} defaultChecked={offered.includes(s.id)} />
                      {s.name}{!s.active && " (hidden)"}
                    </label>
                    <span className="flex items-center gap-1 text-zinc-600">
                      ₹
                      <input
                        className="input w-24 py-1"
                        name={`price_${s.id}`}
                        inputMode="decimal"
                        aria-label={`Price for ${s.name}`}
                        placeholder={s.priceDisplay ?? "price"}
                        defaultValue={prices[s.id] != null ? String(prices[s.id]! / 100) : ""}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-2"><button className="btn" type="submit">Save profile</button></div>
          </form>
        </section>
      )}
    </>
  );
}
