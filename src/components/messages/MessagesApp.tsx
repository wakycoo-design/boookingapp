"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Avatar, GroupBadge, relativeTime, startPolling } from "./chat-ui";
import { Conversation } from "./Conversation";

type Summary = { id: string; kind: "direct" | "group" | "everyone" | "role"; title: string; otherId: string | null; lastMessageAt: string; preview: string | null; unread: number };
type People = { staff: { id: string; name: string }[]; roles: { id: string; name: string }[] };

export type MessagesAppProps = {
  me: { id: string; name: string };
  selectedId: string | null;
  tz: string;
  bookingPrefix: string;
  canStart: boolean;
  canAnnounce: boolean;
  canModerate: boolean;
  canLinkClients: boolean;
  canLinkBookings: boolean;
};

/** Team messages: the conversation list on the left, the open conversation on the right (one at a time on phones). */
export function MessagesApp(p: MessagesAppProps) {
  const router = useRouter();
  const [list, setList] = useState<Summary[]>([]);
  const [filter, setFilter] = useState("");
  const [composing, setComposing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setList(await api<Summary[]>("/api/messages/conversations"));
    } catch {
      // The list is retried on the next tick.
    }
  }, []);
  useEffect(() => startPolling(refresh, 5000), [refresh]);

  const go = (id: string | null) => router.push(id ? `/admin/messages/${id}` : "/admin/messages");
  const shown = list.filter((c) => c.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const selected = list.find((c) => c.id === p.selectedId);

  return (
    <div className="-mx-4 -my-6 grid h-[calc(100dvh-1px)] grid-cols-1 overflow-hidden border-zinc-200 bg-white md:-mx-10 md:-my-10 md:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className={`flex min-h-0 flex-col border-r border-zinc-200 ${p.selectedId ? "hidden md:flex" : "flex"}`}>
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
          <h1 className="text-lg font-semibold">Messages</h1>
          {(p.canStart || p.canAnnounce) && (
            <button type="button" onClick={() => setComposing((v) => !v)} className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black" aria-expanded={composing}>
              {composing ? "Close" : "+ New"}
            </button>
          )}
        </div>
        {composing && <NewConversation {...p} onCreated={(id) => { setComposing(false); void refresh(); go(id); }} />}
        <div className="px-4 pb-2">
          <input className="input w-full text-sm" placeholder="Search conversations" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search conversations" />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto pb-4">
          {shown.length === 0 && <li className="px-4 py-6 text-sm text-zinc-500">{list.length ? "No match." : "No conversations yet."}</li>}
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => go(c.id)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-zinc-50 ${c.id === p.selectedId ? "bg-zinc-100 hover:bg-zinc-100" : ""}`}
                aria-current={c.id === p.selectedId ? "page" : undefined}
              >
                {c.kind === "direct" ? <Avatar id={c.otherId ?? c.id} name={c.title} /> : <GroupBadge kind={c.kind} />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? "font-semibold text-black" : "font-medium text-zinc-800"}`}>{c.title}</span>
                    <span className="shrink-0 text-[11px] text-zinc-400">{c.preview ? relativeTime(c.lastMessageAt, p.tz) : ""}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${c.unread ? "text-zinc-800" : "text-zinc-500"}`}>{c.preview ?? "No messages yet"}</span>
                    {c.unread > 0 && <span className="shrink-0 rounded-full bg-green-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">{c.unread > 99 ? "99+" : c.unread}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className={`min-h-0 ${p.selectedId ? "flex" : "hidden md:flex"} flex-col`}>
        {p.selectedId ? (
          <Conversation
            key={p.selectedId}
            conversationId={p.selectedId}
            me={p.me}
            tz={p.tz}
            bookingPrefix={p.bookingPrefix}
            canModerate={p.canModerate}
            canLinkClients={p.canLinkClients}
            canLinkBookings={p.canLinkBookings}
            onBack={() => go(null)}
            onActivity={() => void refresh()}
          />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <p className="text-4xl" aria-hidden="true">💬</p>
              <h2 className="mt-3 font-semibold">Team messages</h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-600">Pick a conversation, or start one with a colleague, a group, or the whole team.</p>
            </div>
          </div>
        )}
        {selected === undefined && p.selectedId && list.length > 0 && <span className="sr-only">Loading conversation</span>}
      </section>
    </div>
  );
}

/** Start a chat with one person, a group, or (with the permission) a whole role or everyone. */
function NewConversation(p: MessagesAppProps & { onCreated: (id: string) => void }) {
  const [people, setPeople] = useState<People | null>(null);
  const [tab, setTab] = useState<"person" | "group" | "role">(p.canStart ? "person" : "role");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<People>("/api/messages/people").then(setPeople, (e: Error) => setError(e.message));
  }, []);

  async function start(body: object) {
    try {
      const { id } = await api<{ id: string }>("/api/messages/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      p.onCreated(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const others = (people?.staff ?? []).filter((s) => s.id !== p.me.id && s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const tabs = [...(p.canStart ? (["person", "group"] as const) : []), ...(p.canAnnounce ? (["role"] as const) : [])];

  return (
    <div className="mx-4 mb-3 rounded-xl border border-zinc-200 p-3">
      <div className="mb-2 flex gap-1 text-xs" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-2.5 py-1 ${tab === t ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
            {t === "person" ? "Person" : t === "group" ? "Group" : "Everyone / role"}
          </button>
        ))}
      </div>
      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      {tab === "role" ? (
        <ul className="max-h-48 overflow-y-auto">
          {(people?.roles ?? []).map((r) => (
            <li key={r.id}><button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50" onClick={() => void start({ kind: "role", roleId: r.id })}><GroupBadge kind="role" />All {r.name}</button></li>
          ))}
          <li className="px-2 pt-1 text-xs text-zinc-500">The Everyone conversation is always in your list.</li>
        </ul>
      ) : (
        <>
          {tab === "group" && <input className="input mb-2 w-full text-sm" placeholder="Group name, e.g. Weekend cover" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />}
          <input className="input mb-1 w-full text-sm" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-48 overflow-y-auto">
            {others.map((s) => (
              <li key={s.id}>
                {tab === "person" ? (
                  <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50" onClick={() => void start({ kind: "direct", staffId: s.id })}><Avatar id={s.id} name={s.name} size="sm" />{s.name}</button>
                ) : (
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-50">
                    <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} />
                    <Avatar id={s.id} name={s.name} size="sm" />{s.name}
                  </label>
                )}
              </li>
            ))}
          </ul>
          {tab === "group" && (
            <button type="button" disabled={!title.trim() || !picked.length} onClick={() => void start({ kind: "group", title, memberIds: picked })} className="mt-2 w-full rounded-full bg-zinc-900 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              Create group{picked.length ? ` with ${picked.length + 1}` : ""}
            </button>
          )}
        </>
      )}
    </div>
  );
}
