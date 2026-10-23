import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { app } from "@/features/container";
import { bookingReference } from "@/features/bookings/bookings.dto";
import { PERIODS } from "@/features/performance/performance.dto";
import type { ClientRow, SessionOutcome } from "@/features/performance/performance.dto";
import { isDomainError } from "@/features/shared/errors";
import { dayLabel, timeLabel } from "@/lib/format";
import { can, requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const pct = (r: number) => `${Math.round(r * 100)}%`;
const ordinal = (n: number) => ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`;
const OUTCOME: Record<SessionOutcome, { label: string; tone: string }> = {
  came_back: { label: "Came back", tone: "text-[var(--forest)]" },
  waiting: { label: "Waiting", tone: "text-zinc-500" },
  not_back: { label: "Did not return", tone: "text-zinc-700" },
};
const CLIENT_STATUS: Record<ClientRow["status"], { label: string; tone: string }> = {
  new: { label: "New", tone: "border-zinc-300 text-zinc-600" },
  ongoing: { label: "Ongoing", tone: "border-[var(--forest-line)] text-[var(--forest)]" },
  recent: { label: "Recent", tone: "border-zinc-300 text-zinc-700" },
  concluded: { label: "Concluded", tone: "border-zinc-800 text-zinc-900" },
};

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}

export default async function TherapistPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  const { id } = await params;
  const { period } = await searchParams;
  const me = await requirePermission("reports", "view");
  if (me.id !== id && !can(me.permissions, "reports", "viewAll")) redirect("/?error=forbidden");
  const [d, firm] = await Promise.all([
    app().performance.therapist({ staffId: id, period }).catch((err) => {
      if (isDomainError(err) && err.code === "not_found") notFound();
      throw err;
    }),
    app().settings.get(),
  ]);
  const t = d.therapist;
  const first = t.retention.steps[0];
  const tz = firm.timezone;
  const query = `period=${d.period}`;

  return (
    <>
      <p className="no-print mb-2 text-sm"><Link href={`/admin/reports/therapists?${query}`} className="text-zinc-500 hover:text-black">← All therapists</Link></p>
      <PageHeader
        title={t.name}
        subtitle={`${t.designation ? `${t.designation} · ` : ""}${d.label}, ${dayLabel(d.from, tz)} to ${dayLabel(d.to, tz)}`}
        action={
          <span className="no-print flex gap-2">
            <a className="btn-ghost" href={`/admin/export/therapist/${id}?${query}`}>Download (CSV)</a>
            <PrintButton />
          </span>
        }
      />
      <nav className="tabs no-print" aria-label="Period">
        {PERIODS.map((p) => (
          <Link key={p.key} href={`/admin/reports/therapists/${id}?period=${p.key}`} className={`tab ${p.key === d.period ? "tab-active" : ""}`}>{p.label}</Link>
        ))}
      </nav>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sessions held" value={String(t.volume.sessions)} note={`${t.volume.clients} client${t.volume.clients === 1 ? "" : "s"}`} />
        <Stat label="Came back after 1st" value={first.rate === null ? "–" : pct(first.rate)} note={first.cohort === 0 ? "no first sessions" : `${first.returned} of ${first.returned + first.lost}${first.waiting ? ` · ${first.waiting} waiting` : ""}`} />
        <Stat label="Concluded" value={t.conclusion.rate === null ? "–" : pct(t.conclusion.rate)} note={t.conclusion.activeClients === 0 ? "no clients" : `${t.conclusion.concluded} of ${t.conclusion.activeClients} clients`} />
        <Stat
          label="Punctuality"
          value={t.punctuality.status === "ok" ? `${pct(t.punctuality.onTimeRate)} on time` : "Not connected"}
          note={t.punctuality.status === "ok" ? `avg ${Math.round(t.punctuality.avgMinutesLate)} min late` : "needs Google Meet"}
        />
      </div>

      <section className="card mb-6 p-5">
        <h2 className="mb-4 font-semibold">Do clients come back?</h2>
        <div className="grid gap-2.5">
          {t.retention.steps.map((s) => (
            <div key={s.after} className="grid grid-cols-[4.5rem_1fr_11rem] items-center gap-3 text-sm">
              <span className="text-zinc-600">After {ordinal(s.after)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-[#e9be65]" style={{ width: `${Math.round((s.rate ?? 0) * 100)}%` }} /></div>
              <span className="tabular-nums text-zinc-700">
                {s.rate === null ? <span className="text-zinc-400">–</span> : <b className="font-medium">{pct(s.rate)}</b>}
                <span className="ml-2 text-xs text-zinc-400">{s.cohort === 0 ? "none" : `${s.returned}/${s.returned + s.lost}${s.waiting ? ` · ${s.waiting} waiting` : ""}`}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 font-semibold">Clients</h2>
        <div className="card overflow-x-auto">
          <table className="table min-w-full">
            <thead><tr><th>Client</th><th>Sessions</th><th>First</th><th>Last</th><th>Next booked</th><th>Status</th></tr></thead>
            <tbody>
              {d.clients.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-sm text-zinc-600">No clients in this period.</td></tr>}
              {d.clients.map((c) => (
                <tr key={c.clientId}>
                  <td><span className="font-medium">{c.name}</span><span className="block text-xs text-zinc-500">{c.phone}</span></td>
                  <td className="tabular-nums">{c.sessionsInPeriod}<span className="text-xs text-zinc-400"> of {c.sessionsTotal}</span></td>
                  <td className="whitespace-nowrap text-zinc-600">{dayLabel(c.firstAt, tz)}</td>
                  <td className="whitespace-nowrap text-zinc-600">{c.lastAt ? dayLabel(c.lastAt, tz) : "–"}</td>
                  <td className="whitespace-nowrap text-zinc-600">{c.nextAt ? dayLabel(c.nextAt, tz) : "–"}</td>
                  <td><span className={`badge ${CLIENT_STATUS[c.status].tone}`}>{CLIENT_STATUS[c.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 font-semibold">Sessions</h2>
        <div className="card overflow-x-auto">
          <table className="table min-w-full">
            <thead><tr><th>When</th><th>Booking</th><th>Client</th><th>Service</th><th>No.</th><th>After this session</th></tr></thead>
            <tbody>
              {d.sessions.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-sm text-zinc-600">No sessions in this period.</td></tr>}
              {d.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap"><span className="font-medium">{dayLabel(s.startsAt, tz)}</span><span className="block text-xs text-zinc-500">{timeLabel(s.startsAt, tz)} – {timeLabel(s.endsAt, tz)}</span></td>
                  <td className="whitespace-nowrap tabular-nums text-zinc-600"><Link href={`/admin/bookings/${s.id}`} className="hover:underline">{bookingReference(firm.bookingPrefix, s.number)}</Link></td>
                  <td>{s.clientName}</td>
                  <td className="text-zinc-600">{s.serviceName}</td>
                  <td className="tabular-nums text-zinc-600">{s.ordinal ?? <span className="text-xs text-zinc-400">booked</span>}</td>
                  <td>{s.outcome ? <span className={OUTCOME[s.outcome].tone}>{OUTCOME[s.outcome].label}</span> : <span className="text-zinc-300">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.sessions.length === 500 && <p className="mt-2 text-xs text-zinc-500">Showing the latest 500 sessions.</p>}
      </section>
      <p className="text-xs text-zinc-400">Concluded means nothing is booked and the last session was more than {d.graceDays} days ago: a successful completion or an early exit. Prepared {dayLabel(new Date(), tz)}.</p>
    </>
  );
}
