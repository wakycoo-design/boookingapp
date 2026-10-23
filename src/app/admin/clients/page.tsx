import Link from "next/link";
import { app } from "@/features/container";
import { clientReference } from "@/features/clients/clients.dto";
import { dayRange } from "@/lib/day-range";
import { phoneLabel } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; from?: string; to?: string }> }) {
  await requirePermission("clients", "view");
  const { q, from, to } = await searchParams;
  const tz = (await app().settings.get()).timezone;
  const range = dayRange(from, to, tz);
  const rows = await app().clients.list({ q: q?.trim() || undefined, limit: 200, ...range });
  const filtered = Boolean(range.from || range.to);
  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Everyone who has booked or been added. Clients are matched by mobile number."
        action={<Link href="/admin/clients/new" className="btn">New client</Link>}
      />
      <div className="mb-6 flex flex-wrap items-start gap-2">
        <form className="flex max-w-md flex-1 gap-2" action="/admin/clients">
          {from && <input type="hidden" name="from" value={from} />}
          {to && <input type="hidden" name="to" value={to} />}
          <input className="input" name="q" defaultValue={q} placeholder="Search name, phone or email" aria-label="Search clients" />
          <button className="btn-ghost" type="submit">Search</button>
        </form>
        {/* Rarely needed, so folded away; it stays open while a date filter is on. */}
        <details open={filtered}>
          <summary className="btn-ghost cursor-pointer list-none select-none">
            Filters{filtered && <span className="rounded-full bg-black px-1.5 text-[11px] font-medium text-white">1</span>}
          </summary>
          <form action="/admin/clients" className="card mt-2 flex flex-wrap items-end gap-3 p-4">
            {q && <input type="hidden" name="q" value={q} />}
            <fieldset className="flex flex-wrap items-end gap-2">
              <legend className="label">Registered between</legend>
              <input className="input w-auto" name="from" type="date" defaultValue={from ?? ""} aria-label="From" />
              <span className="pb-2 text-sm text-zinc-500">to</span>
              <input className="input w-auto" name="to" type="date" defaultValue={to ?? ""} aria-label="To" />
            </fieldset>
            <button className="btn" type="submit">Apply</button>
            {filtered && <Link className="btn-ghost" href={q ? `/admin/clients?q=${encodeURIComponent(q)}` : "/admin/clients"}>Clear</Link>}
          </form>
        </details>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Client ID</th><th>Name</th><th>Mobile</th><th>Email</th><th>WhatsApp</th><th className="text-right">Bookings</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-zinc-600">No clients{q || filtered ? " match these filters" : " yet"}.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className="row-link">
                <td className="font-mono text-xs text-zinc-600">{clientReference(c.number)}</td>
                <td><Link className="row-link-target font-medium" href={`/admin/clients/${c.id}`}>{c.name}</Link></td>
                <td className="whitespace-nowrap text-zinc-600">{phoneLabel(c.phoneE164)}</td>
                <td className="text-zinc-600">{c.email ?? "–"}</td>
                <td>{c.whatsappOptIn ? "Yes" : "No"}</td>
                <td className="text-right">{c.bookings}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
