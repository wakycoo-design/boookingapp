import Link from "next/link";
import { app } from "@/features/container";
import { requireStaff } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { saveSettingsAction, sendSampleEmailAction, sendTestEmailAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const me = await requireStaff("admin");
  const { error, ok } = await searchParams;
  const mail = app().mail.status();
  const s = await app().settings.get();
  return (
    <>
      <PageHeader title="Email & design" subtitle="The mailbox the app sends from, and how its emails look." />
      <Notice error={error} ok={ok} />
      <form action={saveSettingsAction.bind(null, "email")} className="grid max-w-3xl gap-6">
        <section className="card grid gap-4 p-6">
          <h2 className="font-semibold">Email design</h2>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="toggle mt-0.5" name="emailBranded" defaultChecked={s.emailBranded} />
            <span>Use the branded email design<span className="block text-zinc-600">Your logo and firm name at the top, in forest green and gold, with buttons for the join link and the calendar. Off sends plain text.</span></span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="submit">Save</button>
            <Link href="/admin/email-preview" className="btn-ghost w-fit">Preview the confirmation email</Link>
          </div>
        </section>
      </form>

      <section className="card mt-6 grid max-w-3xl gap-4 p-6">
        <h2 className="font-semibold">Mailbox</h2>
        <p className="text-sm text-zinc-600">
          Every email the app sends (confirmations, reminders, cancellations, payment and staff alerts) goes out from one mailbox. Each workflow only changes the subject and the text.
        </p>
        {mail.configured ? (
          <p className="text-sm">
            <span className="badge border-[var(--forest-line)] text-[var(--forest)]">Connected</span>{" "}
            Sending from <strong>{mail.from}</strong> through {mail.host}
            {mail.replyTo ? <>; replies go to <strong>{mail.replyTo}</strong></> : null}.
          </p>
        ) : (
          <p className="text-sm font-medium text-red-700">
            Not connected yet. Add {mail.missing.join(", ") || "the email settings"} in your host&apos;s environment settings (see docs/deploy-vercel.md), then redeploy.
          </p>
        )}
        {mail.configured && mail.missing.length > 0 && (
          <p className="text-sm text-zinc-600">Still empty: {mail.missing.join(", ")}. Most mail providers need a login too.</p>
        )}
        <form action={sendTestEmailAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="label" htmlFor="to">Send a test email to</label>
            <input className="input" id="to" name="to" type="email" defaultValue={me.email} required />
          </div>
          <button className="btn-ghost" type="submit">Send test email</button>
        </form>
        <form action={sendSampleEmailAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label className="label" htmlFor="sampleTo">Send the sample confirmation (with the design) to</label>
            <input className="input" id="sampleTo" name="to" type="email" defaultValue={me.email} required />
          </div>
          <button className="btn-ghost" type="submit">Send sample</button>
        </form>
      </section>
    </>
  );
}
