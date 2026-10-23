import { app } from "@/features/container";
import { dayLabel, timeLabel } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { readAllNotificationsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const me = await requirePermission("notifications", "view");
  const { error, ok } = await searchParams;
  const [items, unread, s] = await Promise.all([app().inbox.list(me.id), app().inbox.unread(me.id), app().settings.get()]);
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up."}
        action={unread ? <form action={readAllNotificationsAction}><button className="btn-ghost" type="submit">Mark all as read</button></form> : undefined}
      />
      <Notice error={error} ok={ok} />
      {items.length === 0 ? (
        <p className="card p-6 text-sm text-zinc-600">Nothing yet. New appointments, cancellations, payments and staff changes appear here.</p>
      ) : (
        <ul className="card divide-y divide-zinc-100">
          {items.map((n) => (
            <li key={n.id}>
              <a href={`/admin/notifications/${n.id}`} className={`flex items-start gap-3 px-5 py-4 hover:bg-zinc-50 ${n.readAt ? "" : "bg-green-50/60"}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-green-600"}`} aria-label={n.readAt ? undefined : "Unread"} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.readAt ? "text-zinc-700" : "font-medium text-black"}`}>{n.title}</span>
                  {n.body && <span className="block text-sm text-zinc-600">{n.body}</span>}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">{dayLabel(n.createdAt, s.timezone)}, {timeLabel(n.createdAt, s.timezone)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
