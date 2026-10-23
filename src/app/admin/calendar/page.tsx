import Link from "next/link";
import { app } from "@/features/container";
import { addDays } from "@/features/availability/slots";
import { can, requirePermission } from "@/lib/session";
import { zonedToUtc } from "@/lib/time";
import { dayLabel, isoDay, timeLabel } from "@/lib/format";
import { PageHeader } from "@/components/Shell";

export const dynamic = "force-dynamic";

const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_PX = 56;

/** Monday of the week containing `date` (YYYY-MM-DD). */
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string; staff?: string }> }) {
  const me = await requirePermission("calendar", "view");
  // Without "view everyone's", only their own, whatever the address asks for.
  const seesAll = can(me.permissions, "calendar", "viewAll");
  const sp = await searchParams;
  const { bookings, staff, settings } = app();
  const s = await settings.get();
  const tz = s.timezone;
  const today = isoDay(new Date(), tz);
  const monday = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const staffFilter = !seesAll ? me.id : sp.staff === "all" ? null : sp.staff || null;
  const [rows, people] = await Promise.all([
    bookings.list({
      view: "all",
      staffId: staffFilter,
      from: zonedToUtc(`${monday}T00:00`, tz),
      to: zonedToUtc(`${addDays(monday, 7)}T00:00`, tz),
      limit: 500,
    }),
    staff.list(),
  ]);
  // A booking whose payment ran out has given its time back, so it takes no space on the diary.
  const live = rows.filter((b) => b.status !== "cancelled" && !b.slotReleased);
  const minutesIntoDay = (d: Date) => {
    const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).split(":").map(Number);
    return h * 60 + m;
  };
  const href = (week: string) => `/admin/calendar?${new URLSearchParams({ week, staff: staffFilter ?? "all" })}`;

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`Week of ${dayLabel(new Date(`${monday}T12:00:00Z`), "UTC")}`}
        action={
          <div className="flex items-center gap-2">
            <form action="/admin/calendar" className="flex gap-2">
              <input type="hidden" name="week" value={monday} />
              <select className="input w-44" name="staff" defaultValue={staffFilter ?? "all"} aria-label="Staff member">
                <option value="all">Everyone</option>
                {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn-ghost" type="submit">Show</button>
            </form>
            <Link className="btn-ghost" href={href(addDays(monday, -7))} aria-label="Previous week">‹</Link>
            <Link className="btn-ghost" href={href(today)}>Today</Link>
            <Link className="btn-ghost" href={href(addDays(monday, 7))} aria-label="Next week">›</Link>
          </div>
        }
      />
      <div className="card overflow-x-auto">
        <div className="grid min-w-[56rem] grid-cols-[3.5rem_repeat(7,1fr)]">
          <div className="border-b border-zinc-200" />
          {days.map((d) => (
            <div key={d} className={`border-b border-l border-zinc-200 px-3 py-3 text-sm ${d === today ? "text-black" : "text-zinc-600"}`}>
              {dayLabel(new Date(`${d}T12:00:00Z`), "UTC")}
              {d === today && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-black align-middle" />}
            </div>
          ))}
          <div className="relative" style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
            {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
              <span key={i} className="absolute right-2 -translate-y-1/2 text-[11px] text-zinc-600" style={{ top: i * HOUR_PX }}>
                {i === 0 ? "" : `${(FIRST_HOUR + i) % 12 || 12}${FIRST_HOUR + i < 12 ? "am" : "pm"}`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="relative border-l border-zinc-200" style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
              {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                <div key={i} className="absolute inset-x-0 border-t border-zinc-100" style={{ top: i * HOUR_PX }} />
              ))}
              {live
                .filter((b) => isoDay(b.startsAt, tz) === d)
                .map((b) => {
                  const top = ((minutesIntoDay(b.startsAt) - FIRST_HOUR * 60) / 60) * HOUR_PX;
                  const height = Math.max(((b.endsAt.getTime() - b.startsAt.getTime()) / 3_600_000) * HOUR_PX - 2, 20);
                  return (
                    <Link
                      key={b.id}
                      href={`/admin/bookings/${b.id}`}
                      className="absolute inset-x-1 overflow-hidden rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs shadow-sm hover:border-zinc-600"
                      style={{ top: Math.max(top, 0), height }}
                      title={`${b.serviceName} with ${b.clientName}`}
                    >
                      <span className="block truncate font-medium text-black">{b.clientName}</span>
                      <span className="block truncate text-zinc-600">{timeLabel(b.startsAt, tz)} · {b.serviceName}{!staffFilter && ` · ${b.staffName}`}</span>
                    </Link>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-600">Showing {FIRST_HOUR}am to {LAST_HOUR - 12}pm in {tz}.</p>
    </>
  );
}
