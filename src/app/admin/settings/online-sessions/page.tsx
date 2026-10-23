import { app } from "@/features/container";
import { requireStaff } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { saveSettingsAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function OnlineSessionsSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireStaff("admin");
  const { error, ok } = await searchParams;
  const s = await app().settings.get();
  return (
    <>
      <PageHeader title="Online sessions" subtitle="Video links for online sessions." />
      <Notice error={error} ok={ok} />
      <form action={saveSettingsAction.bind(null, "online-sessions")} className="grid max-w-3xl gap-6">
        <section className="card grid gap-4 p-6">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="toggle mt-0.5" name="meetEnabled" defaultChecked={s.meetEnabled} />
            <span>Use Google Meet for online sessions<span className="block text-zinc-600">Services set to &ldquo;Online with Google Meet&rdquo; get a Meet link in the therapist&apos;s calendar event, and clients get a join link in their messages. Each therapist must have Google Calendar connected (Staff, their name, Google Calendar).</span></span>
          </label>
        </section>
        <div><button className="btn" type="submit">Save</button></div>
      </form>
    </>
  );
}
