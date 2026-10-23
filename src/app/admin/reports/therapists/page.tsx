import Link from "next/link";
import { app } from "@/features/container";
import { PERIODS } from "@/features/performance/performance.dto";
import { isPeriodKey } from "@/features/performance/performance.periods";
import type { RetentionStep, TherapistReport } from "@/features/performance/performance.dto";
import { RETENTION_STEPS } from "@/features/performance/kpis";
import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import { ReportsNav } from "@/components/ReportsNav";

export const dynamic = "force-dynamic";

const pct = (r: number) => `${Math.round(r * 100)}%`;
const ordinal = (n: number) => ["1st", "2nd", "3rd"][n - 1] ?? `${n}th`;

/** A rate with a hairline bar under it and the counts it came from; a dash when nobody can be judged yet. */
function Rate({ rate, caption }: { rate: number | null; caption: string }) {
  return (
    <div className="min-w-14">
      {rate === null ? <span className="text-zinc-300">–</span> : <span className="font-medium tabular-nums">{pct(rate)}</span>}
      <div className="mt-1 h-0.5 w-12 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-[#e9be65]" style={{ width: `${Math.round((rate ?? 0) * 100)}%` }} /></div>
      <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-400">{caption}</span>
    </div>
  );
}

const stepCaption = (s: RetentionStep) => (s.cohort === 0 ? "none" : `${s.returned}/${s.returned + s.lost}${s.waiting ? ` · ${s.waiting} waiting` : ""}`);

function Row({ t, period }: { t: TherapistReport; period: string }) {
  return (
    <tr>
      <td className="whitespace-nowrap">
        <Link href={`/admin/reports/therapists/${t.staffId}?period=${period}`} className="font-medium hover:underline">{t.name}</Link>
        {t.designation && <span className="block text-xs text-zinc-500">{t.designation}</span>}
      </td>
      <td className="tabular-nums">
        <span className="font-medium">{t.volume.sessions}</span>
        <span className="block text-[11px] text-zinc-400">{t.volume.clients} client{t.volume.clients === 1 ? "" : "s"}</span>
      </td>
      {t.retention.steps.map((s) => (
        <td key={s.after}><Rate rate={s.rate} caption={stepCaption(s)} /></td>
      ))}
      <td><Rate rate={t.conclusion.rate} caption={t.conclusion.activeClients === 0 ? "none" : `${t.conclusion.concluded} of ${t.conclusion.activeClients}`} /></td>
      <td className="whitespace-nowrap">
        {t.punctuality.status === "ok" ? (
          <>
            <span className="font-medium tabular-nums">{pct(t.punctuality.onTimeRate)} on time</span>
            <span className="block text-[11px] text-zinc-400">avg {Math.round(t.punctuality.avgMinutesLate)} min late · {t.punctuality.measured}/{t.punctuality.sessions} measured</span>
          </>
        ) : (
          <span className="text-xs text-zinc-400">Not connected yet</span>
        )}
      </td>
    </tr>
  );
}

export default async function TherapistPerformancePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requirePermission("reports", "viewAll");
  const { period } = await searchParams;
  const report = await app().performance.report({ period });
  const active = isPeriodKey(period) ? period : report.period;

  return (
    <>
      <PageHeader title="Reports" subtitle="How each therapist's clients carry on with treatment." />
      <ReportsNav active="therapists" />
      <nav className="tabs" aria-label="Period">
        {PERIODS.map((p) => (
          <Link key={p.key} href={`/admin/reports/therapists?period=${p.key}`} className={`tab ${p.key === active ? "tab-active" : ""}`}>{p.label}</Link>
        ))}
      </nav>

      <div className="card overflow-x-auto">
        <table className="table min-w-full">
          <thead>
            <tr>
              <th>Therapist</th>
              <th>Sessions</th>
              {Array.from({ length: RETENTION_STEPS }, (_, i) => (
                <th key={i} className="whitespace-nowrap">After {ordinal(i + 1)}</th>
              ))}
              <th>Concluded</th>
              <th>Punctuality</th>
            </tr>
          </thead>
          <tbody>
            {report.therapists.length === 0 ? (
              <tr><td colSpan={RETENTION_STEPS + 4} className="p-10 text-center text-sm text-zinc-600">No sessions yet.</td></tr>
            ) : (
              report.therapists.map((t) => <Row key={t.staffId} t={t} period={active} />)
            )}
          </tbody>
        </table>
      </div>

      <details className="mt-4 text-sm text-zinc-600">
        <summary className="cursor-pointer text-zinc-500">How this is worked out</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Sessions</b>: sessions held in the period, and with how many clients. A session counts once it is over; cancelled bookings and no-shows do not.</li>
          <li><b>After 1st … 6th</b>: of the clients whose 1st (2nd, 3rd …) session with this therapist fell in the period, the share who came back for another, counting one already booked. A client who has not booked yet is shown as &ldquo;waiting&rdquo; for {report.graceDays} days and left out of the rate until then.</li>
          <li><b>Concluded</b>: of the clients seen in the period, the share whose treatment has ended: nothing booked and the last session more than {report.graceDays} days ago. It covers successful completion and early exit alike; the app does not yet record which.</li>
          <li><b>Punctuality</b>: how soon after the scheduled start the therapist joined the video call. It needs Google Meet to be connected, so it shows as not connected for now.</li>
          <li>A client who moves to another therapist counts as not coming back to the first one.</li>
        </ul>
      </details>
    </>
  );
}
