import Link from "next/link";
import { app } from "@/features/container";
import { kindOf } from "@/features/workflows/workflows.dto";
import { PRESETS } from "@/features/workflows/presets";
import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import { WorkflowForm } from "@/components/WorkflowForm";
import { saveWorkflowAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewWorkflowPage({ searchParams }: { searchParams: Promise<{ preset?: string; kind?: string }> }) {
  await requirePermission("workflows", "add");
  const { preset, kind } = await searchParams;
  const chosen = PRESETS.find((p) => p.key === preset);
  const services = (await app().catalog.list({ activeOnly: true })).map((s) => ({ id: s.id, name: s.name }));
  if (!chosen) {
    return (
      <>
        <PageHeader title="New workflow" subtitle="Pick a starting point. You can change everything on the next screen." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.filter((p) => !kind || kindOf(p.input.action.channel) === kind).map((p) => (
            <Link key={p.key} href={`/admin/workflows/new?preset=${p.key}&kind=${kindOf(p.input.action.channel)}`} className="card p-5 transition-colors hover:border-zinc-400">
              <h2 className="font-medium">{p.title}</h2>
              <p className="mt-1 text-sm text-zinc-600">{p.blurb}</p>
            </Link>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title={chosen.title} subtitle="Check the wording, then save." action={<Link className="btn-ghost" href={`/admin/workflows/new${kind ? `?kind=${kind}` : ""}`}>Pick another</Link>} />
      <WorkflowForm key={chosen.key} initial={chosen.input} services={services} action={saveWorkflowAction.bind(null, null)} submitLabel="Create workflow" />
    </>
  );
}
