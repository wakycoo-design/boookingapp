import { app } from "@/features/container";
import { DEFAULT_IN_APP_EVENTS, INBOX_EVENTS } from "@/features/inbox/events";
import { requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { saveSettingsAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function InAppNotificationsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requirePermission("settings.notifications", "view");
  const { error, ok } = await searchParams;
  const s = await app().settings.get();
  const on = new Set(s.inAppEvents ?? DEFAULT_IN_APP_EVENTS);
  const groups = [...new Set(INBOX_EVENTS.map((e) => e.group))];
  return (
    <>
      <PageHeader title="In-app notifications" subtitle="Which events show in staff's notification bell." />
      <Notice error={error} ok={ok} />
      <form action={saveSettingsAction.bind(null, "notifications")} className="grid max-w-3xl gap-4">
        {groups.map((g) => (
          <section key={g} className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
            <div className="w-40"><h2 className="font-semibold">{g}</h2><p className="text-xs text-zinc-600">Notify when</p></div>
            {INBOX_EVENTS.filter((e) => e.group === g).map((e) => (
              <label key={e.key} className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" className="toggle" name={`ev:${e.key}`} defaultChecked={on.has(e.key)} /> {e.label}
              </label>
            ))}
          </section>
        ))}
        <p className="text-xs text-zinc-600">
          Who sees them is set in Roles &amp; permissions (Notifications): by default each therapist sees their own appointments and leave, and managers and admins see everything switched on here.
          Nobody is told about a change they made themselves.
        </p>
        <div><button className="btn" type="submit">Save</button></div>
      </form>
    </>
  );
}
