import Link from "next/link";
import { app } from "@/features/container";
import { requireStaff } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { NewApiKeyForm } from "@/components/NewApiKeyForm";
import { PageHeader } from "@/components/Shell";
import { revokeApiKeyAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function ApiSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireStaff("admin");
  const { error, ok } = await searchParams;
  const [keys, settings] = await Promise.all([app().apiKeys.list(), app().settings.get()]);
  const when = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: settings.timezone, dateStyle: "medium", timeStyle: "short" }) : "Never");
  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Let your website show times and take bookings. Keep the key on your website's server, never in browser code."
      />
      <Notice error={error} ok={ok} />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-6">
          <h2 className="mb-4 font-semibold">New key</h2>
          <NewApiKeyForm />
        </section>
        <section className="card p-6">
          <h2 className="mb-4 font-semibold">Active keys</h2>
          {!keys.length && <p className="text-sm text-zinc-600">No keys yet.</p>}
          <ul className="divide-y divide-zinc-200">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{k.name}</span>
                  <span className="block text-xs text-zinc-600">{k.keyPrefix}… · {k.scopes.join(", ")} · created {when(k.createdAt)} · last used {when(k.lastUsedAt)}</span>
                </span>
                <form action={revokeApiKeyAction.bind(null, k.id)}>
                  <button className="btn-ghost" type="submit">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
