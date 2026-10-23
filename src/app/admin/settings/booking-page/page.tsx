import Link from "next/link";
import { app } from "@/features/container";
import { requireStaff } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { saveSettingsAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function BookingPageSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireStaff("admin");
  const { error, ok } = await searchParams;
  const s = await app().settings.get();
  return (
    <>
      <PageHeader title="Booking page" subtitle="How the public booking page looks." />
      <Notice error={error} ok={ok} />
      <form action={saveSettingsAction.bind(null, "booking-page")} className="grid max-w-3xl gap-6">
        <section className="card grid gap-4 p-6 sm:grid-cols-2">
          <p className="text-sm text-zinc-600 sm:col-span-2">
            Clients book at <Link className="underline" href="/book" target="_blank">/book</Link>. Share that link, or embed it on your website with an iframe.
            The logo comes from Basic information.
          </p>
          <div><label className="label" htmlFor="brandColor">Brand colour</label><input className="h-10 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-1" id="brandColor" name="brandColor" type="color" defaultValue={s.brandColor} /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="welcomeText">Welcome message</label><textarea className="input" id="welcomeText" name="welcomeText" rows={2} defaultValue={s.welcomeText ?? ""} placeholder="Book an appointment with us. We confirm by WhatsApp." /></div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="embed">Embed on your website</label>
            <input className="input font-mono text-xs" id="embed" readOnly value={`<iframe src="${process.env.AUTH_URL?.replace(/\/$/, "") || "http://localhost:3000"}/book?embed=1" style="width:100%;height:760px;border:0"></iframe>`} />
          </div>
        </section>
        <div><button className="btn" type="submit">Save</button></div>
      </form>
    </>
  );
}
