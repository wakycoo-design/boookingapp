import Link from "next/link";
import { app } from "@/features/container";
import type { CaseListFilters, CaseStatus } from "@/features/case-history/case-history.dto";
import { LABEL, RISK, type Risk } from "@/features/case-history/choices";
import { clientReference } from "@/features/clients/clients.dto";
import { dayRange } from "@/lib/day-range";
import { dateLabel } from "@/lib/format";
import { can, requirePermission } from "@/lib/session";
import { Initials, RiskBadge, StatusBadge } from "@/components/CaseBadges";

export const dynamic = "force-dynamic";
export const metadata = { title: "Case histories" };

const CHIPS: [string, string][] = [["", "All"], ["intake_pending", "Intake pending"], ["in_treatment", "In treatment"], ["concluded", "Concluded"], ["high_risk", "High risk"]];

export default async function CaseHistoriesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; therapist?: string; risk?: string; from?: string; to?: string }> }) {
  const me = await requirePermission("caseHistories", "view");
  const sp = await searchParams;
  const risk = RISK.includes(sp.risk as Risk) ? (sp.risk as Risk) : undefined;
  const s = await app().settings.get();
  const range = dayRange(sp.from, sp.to, s.timezone);
  const base: CaseListFilters = { q: sp.q, therapist: sp.therapist || undefined, risk, ...range };
  const [rows, team] = await Promise.all([app().caseHistory.list({ ...me, seesAll: can(me.permissions, "caseHistories", "viewAll") }, base), app().staff.list()]);
  const filters = [sp.therapist, risk, range.from || range.to].filter(Boolean).length;
  const statusOf = (key: string) => (r: (typeof rows)[number]) => !key || (key === "high_risk" ? r.risk === "high" : r.status === (key as CaseStatus));
  const status = CHIPS.some(([k]) => k === sp.status) ? sp.status ?? "" : "";
  const shown = rows.filter(statusOf(status));
  const href = (patch: Record<string, string>) => `?${new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Case histories</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Intake, diagnosis, risk and session notes. {me.clinicalAdmin ? "As a clinical admin you see every record." : "You can open the records of the clients you treat."}
        </p>
      </div>

      <nav className="tabs" aria-label="Status">
        {CHIPS.map(([key, label]) => (
          <Link key={key} href={href({ status: key })} className={`tab ${status === key ? "tab-active" : ""}`} aria-current={status === key ? "page" : undefined}>
            {label} <span className="tabular-nums text-zinc-500">{rows.filter(statusOf(key)).length}</span>
          </Link>
        ))}
      </nav>

      <div className="mb-4 flex flex-wrap items-start gap-2">
        <form className="flex max-w-md flex-1 gap-2" action="">
          {Object.entries({ status, therapist: sp.therapist, risk, from: sp.from, to: sp.to }).map(([k, val]) => val && <input key={k} type="hidden" name={k} value={val} />)}
          <input className="input" name="q" defaultValue={sp.q ?? ""} placeholder="Search name, client ID or phone" aria-label="Search" />
          <button className="btn-ghost" type="submit">Search</button>
        </form>
        {/* Therapist, risk and dates are used less often than search and the status tabs, so they fold away. */}
        <details open={filters > 0}>
          <summary className="btn-ghost cursor-pointer list-none select-none">
            Filters{filters > 0 && <span className="rounded-full bg-black px-1.5 text-[11px] font-medium text-white">{filters}</span>}
          </summary>
          <form action="" className="card mt-2 flex flex-wrap items-end gap-3 p-4">
            {status && <input type="hidden" name="status" value={status} />}
            {sp.q && <input type="hidden" name="q" value={sp.q} />}
            <div>
              <label className="label" htmlFor="therapist">Therapist</label>
              <select className="input w-auto" id="therapist" name="therapist" defaultValue={sp.therapist ?? ""}>
                <option value="">All therapists</option>
                <option value="unassigned">Unassigned</option>
                <optgroup label="Active">{team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
                {team.some((m) => !m.active) && <optgroup label="Former">{team.filter((m) => !m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="risk">Risk</label>
              <select className="input w-auto" id="risk" name="risk" defaultValue={risk ?? ""}>
                <option value="">Any risk</option>
                {[...RISK].reverse().map((r) => <option key={r} value={r}>{LABEL[r]}</option>)}
              </select>
            </div>
            <fieldset className="flex flex-wrap items-end gap-2">
              <legend className="label">Last session between</legend>
              <input className="input w-auto" name="from" type="date" defaultValue={sp.from ?? ""} aria-label="From" />
              <span className="pb-2 text-sm text-zinc-500">to</span>
              <input className="input w-auto" name="to" type="date" defaultValue={sp.to ?? ""} aria-label="To" />
            </fieldset>
            <button className="btn" type="submit">Apply</button>
            {filters > 0 && <Link className="btn-ghost" href={href({ therapist: "", risk: "", from: "", to: "" })}>Clear</Link>}
          </form>
        </details>
      </div>

      <div className="card overflow-x-auto">
        <table className="table min-w-[56rem]">
          <thead>
            <tr><th>Client</th><th>Status</th><th>Primary diagnosis</th><th>Risk</th><th>Therapist</th><th>Last session note</th><th><span className="sr-only">Open</span></th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-zinc-600">No clients match.</td></tr>}
            {shown.map((r) => (
              <tr key={r.clientId} className="row-link">
                <td>
                  {/* The whole row opens the case, or the client profile for readers who may not see the record. */}
                  <Link className="row-link-target font-medium" href={r.restricted ? `/admin/clients/${r.clientId}` : `/admin/case-histories/${r.clientId}`}>{r.clientName}</Link>
                  <p className="font-mono text-xs text-zinc-600">{clientReference(r.clientNumber)}</p>
                </td>
                <td><StatusBadge status={r.status} /></td>
                <td>
                  {r.restricted ? <span className="text-zinc-500">Restricted</span> : r.diagnosisLabel ? (
                    <>
                      <p>{r.diagnosisLabel}</p>
                      {r.diagnosisCode && <p className="text-xs text-zinc-600">{r.diagnosisCode}</p>}
                    </>
                  ) : <span className="text-zinc-500">Not yet assessed</span>}
                </td>
                <td><RiskBadge risk={r.risk} /></td>
                <td>
                  {r.therapistName ? (
                    <span className="flex items-center gap-2">
                      <Initials name={r.therapistName} muted={!r.therapistActive} />
                      {r.therapistName}
                      {!r.therapistActive && <span className="badge border-red-300 text-red-700">Former</span>}
                    </span>
                  ) : <span className="text-zinc-500">Unassigned</span>}
                </td>
                <td>
                  <p className="tabular-nums">{r.notes === 0 ? "No notes" : `${r.notes} session${r.notes === 1 ? "" : "s"}`}</p>
                  {r.lastNoteAt && <p className="text-xs text-zinc-600">{dateLabel(r.lastNoteAt, s.timezone)}{r.lastNoteAuthor ? ` · by ${r.lastNoteAuthor}` : ""}</p>}
                </td>
                <td className="text-right text-zinc-400" aria-hidden="true">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-zinc-600">Showing {shown.length} of {rows.length}. Diagnosis and notes are shown only to the client&apos;s therapist and clinical admins.</p>
    </>
  );
}
