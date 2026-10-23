import { app } from "@/features/container";
import { isReportRangeKey, presetRange, REPORT_RANGES } from "@/features/reports/ranges";
import { requirePermission } from "@/lib/session";
import { dayLabel } from "@/lib/format";
import { PageHeader } from "@/components/Shell";
import { ReportsNav } from "@/components/ReportsNav";

export const dynamic = "force-dynamic";

function Stat({ label, value, tone = "text-black", note }: { label: string; value: number; tone?: string; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-600">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-zinc-600">{note}</p>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; days?: string; range?: string }> }) {
  await requirePermission("reports", "viewAll");
  const sp = await searchParams;
  const { reports, settings } = app();
  const tz = (await settings.get()).timezone;
  // Quick ranges are worked out from today on the firm's clock. With nothing chosen the page opens on this month, so upcoming
  // bookings show up too (`days` is the older name for the range parameter and still works in saved links).
  const today = (await reports.range({})).to;
  const asked = sp.range ?? sp.days;
  const active = isReportRangeKey(asked) ? asked : sp.from || sp.to ? null : "month";
  const r = await reports.summary(active ? presetRange(active, today) : { from: sp.from, to: sp.to });
  const t = r.totals;
  const busiest = Math.max(0, ...r.perDay.map((d) => d.count));
  const max = Math.max(1, busiest);
  const query = new URLSearchParams({ from: r.from, to: r.to });
  const crowded = r.perDay.length > 45;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${r.from} to ${r.to}, by appointment date.`}
        action={
          <span className="flex flex-wrap gap-2">
            <a className="btn-ghost" href={`/admin/export/bookings?${query}`}>Download bookings (CSV)</a>
            <a className="btn-ghost" href="/admin/export/clients">Download clients (CSV)</a>
          </span>
        }
      />
      <ReportsNav active="overview" />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <nav className="tabs !mb-0" aria-label="Date range">
          {REPORT_RANGES.map(([key, label]) => (
            <a key={key} href={`/admin/reports?range=${key}`} className={`tab ${active === key ? "tab-active" : ""}`}>{label}</a>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2" action="/admin/reports">
          <div><label className="label" htmlFor="from">From</label><input className="input" id="from" name="from" type="date" defaultValue={r.from} /></div>
          <div><label className="label" htmlFor="to">To</label><input className="input" id="to" name="to" type="date" defaultValue={r.to} /></div>
          <button className="btn-ghost" type="submit">Show</button>
        </form>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Bookings" value={t.total} note={`${t.online} booked online`} />
        <Stat label="Scheduled" value={t.scheduled} />
        <Stat label="Completed" value={t.completed} tone="text-green-700" />
        <Stat label="Cancelled" value={t.cancelled} tone="text-red-700" />
        <Stat label="No-shows" value={t.noShow} tone="text-red-700" note={`${t.noShowByClient} client · ${t.noShowByStaff} staff`} />
        <Stat label="Paid" value={t.paid} tone="text-green-700" note={`${t.paymentPending} pending · ${t.paymentFailed} failed`} />
      </div>

      <section className="card mb-6 p-5">
        <h2 className="mb-4 font-semibold">Bookings per day</h2>
        <div className="flex h-40 items-end gap-px" role="img" aria-label={`Bookings per day from ${r.from} to ${r.to}`}>
          {r.perDay.map((d) => (
            <div key={d.date} className="group relative flex h-full flex-1 items-end" title={`${dayLabel(new Date(`${d.date}T12:00:00Z`), "UTC")}: ${d.count}`}>
              <div className={d.count ? "w-full rounded-t bg-black" : "w-full bg-zinc-200"} style={{ height: d.count ? `${Math.max(4, (d.count / max) * 100)}%` : "2px" }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-zinc-600">
          <span>{dayLabel(new Date(`${r.from}T12:00:00Z`), "UTC")}</span>
          {!crowded && busiest > 0 && <span>Busiest day: {busiest} booking{busiest === 1 ? "" : "s"}</span>}
          <span>{dayLabel(new Date(`${r.to}T12:00:00Z`), "UTC")}</span>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {([["By service", r.byService], ["By staff member", r.byStaff]] as const).map(([title, rows]) => (
          <section key={title} className="card overflow-x-auto">
            <h2 className="p-5 pb-0 font-semibold">{title}</h2>
            <table className="table mt-3">
              <thead><tr><th>Name</th><th>Total</th><th>Done</th><th>Cancelled</th><th>No-show</th></tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="text-zinc-600">No bookings in this period.</td></tr>}
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td className="font-medium">{x.name}</td>
                    <td>{x.total}</td>
                    <td className="text-green-700">{x.completed}</td>
                    <td className="text-red-700">{x.cancelled}</td>
                    <td className="text-red-700">{x.noShow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <p className="mt-4 text-xs text-zinc-600">Days are counted on the firm&apos;s clock ({tz}). The daily chart leaves out cancelled bookings.</p>
    </>
  );
}
