import { app } from "@/features/container";
import { requireStaff } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { saveSettingsAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function PaymentsSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireStaff("admin");
  const { error, ok } = await searchParams;
  const s = await app().settings.get();
  return (
    <>
      <PageHeader title="Payments" subtitle="Online payment for website bookings." />
      <Notice error={error} ok={ok} />
      <form action={saveSettingsAction.bind(null, "payments")} className="grid max-w-3xl gap-6">
        <section className="card grid gap-4 p-6">
          <p className="text-sm text-zinc-600">
            Your website takes the payment with Razorpay and reports it here. When this is on, a website booking of a priced service is held for 15 minutes.
            If no payment arrives it shows &ldquo;Payment failed&rdquo; and the time goes back on offer. The client can still come back within 24 hours to choose a time and pay; after that the booking is cancelled.
          </p>
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="toggle" name="onlinePayment" defaultChecked={s.onlinePayment} /> Website bookings must be paid online</label>
          <div>
            <label className="label" htmlFor="resumeUrl">Page on your website to finish payment</label>
            <input className="input" id="resumeUrl" name="resumeUrl" defaultValue={s.resumeUrl ?? ""} placeholder="https://yourfirm.com/my-bookings" />
            <p className="mt-1 text-xs text-zinc-600">Used for <code>{"{{resume_link}}"}</code> in &ldquo;complete your payment&rdquo; messages. We add the booking and a secure token to it.</p>
          </div>
        </section>
        <div><button className="btn" type="submit">Save</button></div>
      </form>
    </>
  );
}
