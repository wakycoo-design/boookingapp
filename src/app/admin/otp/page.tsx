import Link from "next/link";
import { app } from "@/features/container";
import { OTP_STATUSES, OTP_STATUS_LABEL, type OtpStatus } from "@/features/otp/otp.dto";
import { requirePermission } from "@/lib/session";
import { NewApiKeyForm } from "@/components/NewApiKeyForm";
import { PageHeader } from "@/components/Shell";
import { revokeApiKeyAction } from "../actions";

export const dynamic = "force-dynamic";

const BADGE: Record<OtpStatus, string> = {
  created: "border-blue-600/40 text-blue-700",
  verified: "border-green-600/40 text-green-700",
  not_verified: "border-red-600/40 text-red-700",
  timed_out: "border-amber-600/40 text-amber-700",
  replaced: "text-zinc-600",
  send_failed: "border-red-600/40 text-red-700",
};

type Search = { status?: string; q?: string; page?: string };

export default async function OtpPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Admin only, checked here and not just in the sidebar.
  await requirePermission("otp", "view");
  const sp = await searchParams;
  const status = OTP_STATUSES.find((s) => s === sp.status);
  const q = sp.q?.trim() || undefined;
  const [report, keys, settings] = await Promise.all([
    app().otp.report({ status, search: q, page: Number(sp.page) || 1 }),
    app().apiKeys.list(),
    app().settings.get(),
  ]);
  const otpKeys = keys.filter((k) => k.scopes.includes("otp"));
  const when = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: settings.timezone, dateStyle: "medium", timeStyle: "medium" }) : "—");
  const href = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    const next = { status: sp.status, q: sp.q, ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    return `/admin/otp${p.size ? `?${p}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(report.total / report.pageSize));
  const tabs: { key: OtpStatus | undefined; label: string; n: number }[] = [
    { key: undefined, label: "All", n: report.counts.all },
    ...(["created", "verified", "not_verified", "timed_out", "send_failed"] as const).map((s) => ({ key: s, label: OTP_STATUS_LABEL[s], n: report.counts[s] })),
  ];
  return (
    <>
      <PageHeader title="OTP Authentication" subtitle="WhatsApp one-time codes sent from your website, and whether each was verified." />
      <nav className="tabs flex-wrap" aria-label="Status">
        {tabs.map((t) => (
          <Link key={t.label} href={href({ status: t.key, page: undefined })} className={`tab ${t.key === status ? "tab-active" : ""}`} aria-current={t.key === status ? "page" : undefined}>
            {t.label} <span className="text-zinc-500">{t.n}</span>
          </Link>
        ))}
      </nav>
      <form className="mb-4 flex max-w-md gap-2" action="/admin/otp">
        {status && <input type="hidden" name="status" value={status} />}
        <input className="input" name="q" defaultValue={q} placeholder="Search phone number or reference" aria-label="Search" />
        <button className="btn-ghost" type="submit">Search</button>
      </form>
      {!report.rows.length ? (
        <p className="card p-6 text-sm text-zinc-600">{q || status ? "No requests match." : "No codes have been sent yet."}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Request</th><th>Phone</th><th>Country</th><th>Reference</th><th>Status</th><th>Created</th><th>Expires</th><th>Verified</th><th>Attempts</th></tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.requestNo}</td>
                  <td className="whitespace-nowrap">{r.phone}</td>
                  <td className="text-zinc-600">{r.countryCode ? `+${r.countryCode}` : "—"}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{r.reference}</td>
                  <td>
                    <span className={`badge ${BADGE[r.status]}`} title={r.failureReason ?? undefined}>{OTP_STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="whitespace-nowrap text-zinc-600">{when(r.createdAt)}</td>
                  <td className="whitespace-nowrap text-zinc-600">{when(r.expiresAt)}</td>
                  <td className="whitespace-nowrap text-zinc-600">{when(r.verifiedAt)}</td>
                  <td>{r.attempts}/{r.maxAttempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <p className="mt-4 flex items-center gap-3 text-sm text-zinc-600">
          {report.page > 1 && <Link className="btn-ghost" href={href({ page: String(report.page - 1) })}>Previous</Link>}
          Page {report.page} of {pages}
          {report.page < pages && <Link className="btn-ghost" href={href({ page: String(report.page + 1) })}>Next</Link>}
        </p>
      )}

      <section className="card mt-10 max-w-3xl p-6">
        <h2 className="mb-1 font-semibold">API keys for OTP</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Your server calls <code>POST /api/v1/otp/send</code> and <code>POST /api/v1/otp/verify</code> with <code>Authorization: Bearer &lt;key&gt;</code>.
          These keys can do nothing else. Keep the key on your server, never in browser code.
        </p>
        <NewApiKeyForm scope="otp" placeholder="e.g. Website login" />
        <ul className="mt-4 divide-y divide-zinc-200">
          {otpKeys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{k.name}</span>
                <span className="block text-xs text-zinc-600">{k.keyPrefix}… · created {when(k.createdAt)} · last used {when(k.lastUsedAt)}</span>
              </span>
              <form action={revokeApiKeyAction.bind(null, k.id)}>
                <button className="btn-ghost" type="submit">Revoke</button>
              </form>
            </li>
          ))}
          {!otpKeys.length && <li className="py-3 text-sm text-zinc-600">No OTP keys yet.</li>}
        </ul>
      </section>
    </>
  );
}
