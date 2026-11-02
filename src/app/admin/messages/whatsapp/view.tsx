import Link from "next/link";
import { notFound } from "next/navigation";
import { isDomainError } from "@/features/shared/errors";
import { app } from "@/features/container";
import type { WaMessageDTO } from "@/features/whatsapp-inbox/whatsapp-inbox.dto";
import { can, requirePermission } from "@/lib/session";
import { MessagesTabs } from "@/components/messages/MessagesTabs";
import { WaAutoRefresh, WaComposer } from "@/components/messages/WaComposer";
import { replyAction } from "./actions";

const TICKS: Record<WaMessageDTO["status"], string> = { received: "", sent: "✓", delivered: "✓✓", read: "✓✓", failed: "!" };

/** Clients' WhatsApp chats: the list on the left, the open chat on the right (one at a time on phones). */
export async function WhatsAppView({ clientId }: { clientId: string | null }) {
  const me = await requirePermission("whatsapp", "view");
  const { whatsappInbox, settings } = app();
  const [threads, s] = await Promise.all([whatsappInbox.threads(), settings.get()]);
  const open = clientId
    ? await whatsappInbox.open(clientId).catch((err: unknown) => {
        if (isDomainError(err) && err.code === "not_found") notFound();
        throw err;
      })
    : null;
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: s.timezone, ...o }).format(d);
  const canReply = can(me.permissions, "whatsapp", "add");

  return (
    <div className="-mx-4 -my-6 grid h-[calc(100dvh-1px)] grid-cols-1 overflow-hidden bg-white md:-mx-10 md:-my-10 md:grid-cols-[20rem_minmax(0,1fr)]">
      <WaAutoRefresh />
      <aside className={`flex min-h-0 flex-col border-r border-zinc-200 ${clientId ? "hidden md:flex" : "flex"}`}>
        <div className="px-4 pb-2 pt-4">
          <MessagesTabs active="whatsapp" showTeam={can(me.permissions, "messages", "view")} showWhatsApp />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto pb-4">
          {threads.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">No WhatsApp chats yet. When a client writes to your business number, it appears here.</li>}
          {threads.map((t) => (
            <li key={t.clientId}>
              <Link
                href={`/admin/messages/whatsapp/${t.clientId}`}
                aria-current={t.clientId === clientId ? "page" : undefined}
                className={`flex items-center gap-3 px-4 py-2.5 transition hover:bg-zinc-50 ${t.clientId === clientId ? "bg-zinc-100 hover:bg-zinc-100" : ""}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-green-600 text-xs font-semibold text-white" aria-hidden="true">{t.clientName.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${t.unread ? "font-semibold text-black" : "font-medium text-zinc-800"}`}>{t.clientName}</span>
                    <span className="shrink-0 text-[11px] text-zinc-400">{fmt(t.lastAt, { day: "numeric", month: "short" })}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${t.unread ? "text-zinc-800" : "text-zinc-500"}`}>{t.preview}</span>
                    {t.unread > 0 && <span className="shrink-0 rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{t.unread > 99 ? "99+" : t.unread}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className={`min-h-0 flex-col ${clientId ? "flex" : "hidden md:flex"}`}>
        {open ? (
          <>
            <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
              <Link href="/admin/messages/whatsapp" className="icon-btn md:hidden" aria-label="Back to chats">←</Link>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{open.client.name}</span>
                <span className="block text-xs text-zinc-500">{open.client.phoneE164}</span>
              </span>
              {can(me.permissions, "clients", "view") && <Link className="btn-ghost" href={`/admin/clients/${open.client.id}`}>Client profile</Link>}
            </header>
            <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-zinc-50 px-4 py-4">
              {open.messages.map((m) => (
                <li key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.direction === "out" ? "self-end bg-green-100" : "self-start bg-white"}`}>
                  {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : <p className="italic text-zinc-500">[{m.kind}: open WhatsApp on the phone to see it]</p>}
                  <p className="mt-1 flex justify-end gap-1.5 text-[10px] text-zinc-500">
                    {m.direction === "out" && m.sentByName && <span>{m.sentByName} ·</span>}
                    <span>{fmt(m.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}</span>
                    {m.direction === "out" && <span className={m.status === "read" ? "text-sky-600" : m.status === "failed" ? "font-semibold text-red-700" : ""} title={m.error ?? m.status}>{TICKS[m.status]}</span>}
                  </p>
                  {m.status === "failed" && <p className="mt-1 text-[11px] text-red-700">Not delivered: {m.error}</p>}
                </li>
              ))}
            </ol>
            {!canReply ? (
              <p className="border-t border-zinc-200 p-3 text-sm text-zinc-500">You can read this chat but not reply.</p>
            ) : open.canReplyUntil ? (
              <WaComposer action={replyAction.bind(null, open.client.id)} />
            ) : (
              <p className="border-t border-zinc-200 p-3 text-sm text-zinc-600">{open.client.name} last wrote more than 24 hours ago. WhatsApp only allows a free reply within 24 hours of the client&apos;s last message; reply from the WhatsApp Business app, or wait for them to write again.</p>
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <h2 className="font-semibold">WhatsApp</h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-600">Clients&apos; messages to your WhatsApp business number. Pick a chat to read and reply.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
