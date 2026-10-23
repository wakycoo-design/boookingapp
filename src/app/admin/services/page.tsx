import Link from "next/link";
import { app } from "@/features/container";
import { requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { ServiceFields } from "@/components/ServiceFields";
import { createServiceAction } from "../actions";

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("services", "view");
  const { error, ok } = await searchParams;
  const rows = await app().catalog.list();
  return (
    <>
      <PageHeader title="Services" subtitle="What clients can book." />
      <Notice error={error} ok={ok} />
      <div className="mb-10 grid gap-3">
        {rows.length === 0 && <p className="card p-6 text-sm text-zinc-600">No services yet. Add your first one below.</p>}
        {rows.map((s) => (
          <Link key={s.id} href={`/admin/services/${s.id}`} className="card flex flex-wrap items-center gap-x-6 gap-y-1 p-4 transition-colors hover:border-zinc-400">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{s.name}</span>
              {s.description && <span className="block truncate text-sm text-zinc-600">{s.description}</span>}
            </span>
            <span className="badge">{s.durationMin} min</span>
            {(s.bufferBeforeMin > 0 || s.bufferAfterMin > 0) && (
              <span className="text-xs text-zinc-600">Buffers {s.bufferBeforeMin}/{s.bufferAfterMin} min</span>
            )}
            <span className="w-24 text-right text-sm">{s.priceDisplay ?? "–"}</span>
            {!s.active && <span className="badge text-zinc-600">Hidden</span>}
          </Link>
        ))}
      </div>
      <section className="card max-w-2xl p-6">
        <h2 className="mb-5 font-semibold">Add a service</h2>
        <form action={createServiceAction} className="grid gap-4 sm:grid-cols-2">
          <ServiceFields />
          <div className="sm:col-span-2"><button className="btn" type="submit">Add service</button></div>
        </form>
      </section>
    </>
  );
}
