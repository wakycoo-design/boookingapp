import { app } from "@/features/container";
import { renderBrandedEmail, SAMPLE_VARS } from "@/features/workflows/email-design";
import { PRESETS } from "@/features/workflows/presets";
import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/Shell";

export const dynamic = "force-dynamic";

/** The confirmation email as clients will see it, with made-up details. */
export default async function EmailPreviewPage() {
  await requirePermission("settings.email", "view");
  const { settings, workflows } = app();
  const firm = await settings.get();
  const own = (await workflows.list()).find((w) => w.channel === "email" && w.trigger === "booked" && w.active);
  const template = own && "body" in own.config ? own.config.body : (PRESETS[0].input.action as { body: string }).body;
  const base = (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  const { html } = renderBrandedEmail({
    template,
    vars: { ...SAMPLE_VARS, firm_name: firm.name },
    subject: "Preview",
    firmName: firm.name,
    logoUrl: firm.logoUrl ?? `${base}/brand/waky-logo.png`,
  });
  return (
    <>
      <PageHeader title="Email preview" subtitle={own ? `Your "${own.name}" workflow, with made-up details.` : "The starter confirmation, with made-up details."} />
      <iframe title="Email preview" srcDoc={html} sandbox="" className="h-[40rem] w-full max-w-3xl rounded-xl border border-zinc-200 bg-white" />
    </>
  );
}
