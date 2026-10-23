"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Avatar, GroupBadge, startPolling } from "./chat-ui";

type Seen = { id: string; name: string; at: string };
type Msg = {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  clientId: string | null;
  clientName: string | null;
  bookingId: string | null;
  bookingNumber: number | null;
  bookingStartsAt: string | null;
  attachments: { id: string; fileName: string; contentType: string; size: number }[];
  seenBy: Seen[];
};
type Member = { id: string; name: string };
type Info = { id: string; kind: "direct" | "group" | "everyone" | "role"; title: string; members: Member[] };
type Linked = { kind: "client" | "booking"; id: string; label: string };

export type ConversationProps = {
  conversationId: string;
  me: { id: string; name: string };
  tz: string;
  bookingPrefix: string;
  canModerate: boolean;
  canLinkClients: boolean;
  canLinkBookings: boolean;
  onBack: () => void;
  onActivity: () => void;
};

const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
const dayTitle = (iso: string, tz: string) => {
  const k = dayKey(iso, tz);
  if (k === dayKey(new Date().toISOString(), tz)) return "Today";
  if (k === dayKey(new Date(Date.now() - 86_400_000).toISOString(), tz)) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
};
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Makes "@Name" stand out, for names of people in the conversation. */
function withMentions(body: string, names: string[]) {
  if (!names.length || !body.includes("@")) return body;
  const pattern = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length).join("|")}))`, "gi");
  return body.split(pattern).map((part, i) => (i % 2 ? <span key={i} className="rounded bg-green-100 px-0.5 font-medium text-green-800">{part}</span> : part));
}

export function Conversation(p: ConversationProps) {
  const [info, setInfo] = useState<Info | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const d = await api<{ conversation: Info; messages: Msg[] }>(`/api/messages/${p.conversationId}`);
      setInfo(d.conversation);
      setMessages(d.messages);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [p.conversationId]);

  useEffect(() => startPolling(load, 3000), [load]);

  // Scroll to the newest message when new ones arrive (not when only "seen" changes).
  useEffect(() => {
    if (messages.length !== lastCount.current) bottom.current?.scrollIntoView({ block: "end" });
    lastCount.current = messages.length;
  }, [messages.length]);

  const names = useMemo(() => (info?.members ?? []).map((m) => m.name), [info]);
  const lastMine = [...messages].reverse().find((m) => m.senderId === p.me.id && !m.deleted);
  const latest = messages[messages.length - 1];
  const others = (info?.members ?? []).filter((m) => m.id !== p.me.id);

  async function saveEdit() {
    if (!editing) return;
    try {
      await api(`/api/messages/message/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: editing.text }) });
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/messages/message/${id}`, { method: "DELETE" });
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
        <button type="button" onClick={p.onBack} className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 md:hidden" aria-label="Back to conversations">←</button>
        {info && (info.kind === "direct" ? <Avatar id={others[0]?.id ?? info.id} name={info.title} /> : <GroupBadge kind={info.kind} />)}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{info?.title ?? "…"}</h2>
          {info && info.kind !== "direct" && (
            <p className="truncate text-xs text-zinc-500">{info.members.length} {info.members.length === 1 ? "person" : "people"}{info.kind === "everyone" ? " · the whole team" : ""}</p>
          )}
        </div>
        {info && info.kind !== "direct" && (
          <div className="hidden -space-x-1.5 sm:flex">
            {info.members.slice(0, 6).map((m) => <Avatar key={m.id} id={m.id} name={m.name} size="sm" ring />)}
            {info.members.length > 6 && <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-200 text-[10px] font-medium ring-2 ring-white">+{info.members.length - 6}</span>}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 px-4 py-4">
        {messages.length === 0 && !error && <p className="mt-16 text-center text-sm text-zinc-500">No messages yet. Say hello 👋</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayKey(prev.createdAt, p.tz) !== dayKey(m.createdAt, p.tz);
          const grouped = !newDay && prev && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          const mine = m.senderId === p.me.id;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-4 flex items-center gap-3 text-xs text-zinc-500">
                  <span className="h-px flex-1 bg-zinc-200" />{dayTitle(m.createdAt, p.tz)}<span className="h-px flex-1 bg-zinc-200" />
                </div>
              )}
              <div className={`group flex gap-2 ${mine ? "flex-row-reverse" : ""} ${grouped ? "mt-0.5" : "mt-3"}`}>
                <div className="w-7 shrink-0">{!mine && !grouped && <Avatar id={m.senderId} name={m.senderName} size="sm" />}</div>
                <div className={`flex max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  {!mine && !grouped && info?.kind !== "direct" && <span className="mb-0.5 px-1 text-xs font-medium text-zinc-600">{m.senderName}</span>}
                  {editing?.id === m.id ? (
                    <div className="w-80 max-w-full rounded-2xl border border-zinc-300 bg-white p-2">
                      <textarea className="w-full resize-none bg-transparent text-sm outline-none" rows={3} value={editing.text} autoFocus onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); } if (e.key === "Escape") setEditing(null); }} />
                      <div className="flex justify-end gap-2 text-xs">
                        <button type="button" className="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100" onClick={() => setEditing(null)}>Cancel</button>
                        <button type="button" className="rounded bg-zinc-900 px-2 py-1 text-white" onClick={() => void saveEdit()}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setOpenInfo(openInfo === m.id ? null : m.id)}
                      className={`rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed shadow-sm transition ${m.deleted ? "border border-dashed border-zinc-300 bg-transparent italic text-zinc-500 shadow-none" : mine ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white text-zinc-900"} ${mine ? "rounded-br-md" : "rounded-bl-md"}`}
                      aria-expanded={openInfo === m.id}
                      title="Show who has seen it"
                    >
                      {m.deleted ? "Message deleted" : (
                        <>
                          {m.body && <span className="whitespace-pre-wrap break-words">{withMentions(m.body, names)}</span>}
                          {(m.clientId || m.bookingId) && (
                            <span className="mt-1.5 flex flex-col gap-1">
                              {m.clientId && <a href={`/admin/clients/${m.clientId}`} onClick={(e) => e.stopPropagation()} className={`rounded-lg px-2.5 py-1.5 text-xs ${mine ? "bg-white/10 hover:bg-white/20" : "bg-zinc-100 hover:bg-zinc-200"}`}>👤 {m.clientName ?? "Client"}</a>}
                              {m.bookingId && <a href={`/admin/bookings/${m.bookingId}`} onClick={(e) => e.stopPropagation()} className={`rounded-lg px-2.5 py-1.5 text-xs ${mine ? "bg-white/10 hover:bg-white/20" : "bg-zinc-100 hover:bg-zinc-200"}`}>📅 {p.bookingPrefix}{m.bookingNumber}{m.bookingStartsAt ? ` · ${new Intl.DateTimeFormat("en-IN", { timeZone: p.tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(m.bookingStartsAt))}` : ""}</a>}
                            </span>
                          )}
                          {m.attachments.length > 0 && (
                            <span className="mt-1.5 flex flex-wrap gap-1.5">
                              {m.attachments.map((a) =>
                                a.contentType.startsWith("image/") ? (
                                  <a key={a.id} href={`/api/messages/file/${a.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- private, signed-in file; next/image can't fetch it */}
                                    <img src={`/api/messages/file/${a.id}`} alt={a.fileName} className="max-h-48 max-w-60 rounded-lg object-cover" />
                                  </a>
                                ) : (
                                  <a key={a.id} href={`/api/messages/file/${a.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={`rounded-lg px-2.5 py-1.5 text-xs ${mine ? "bg-white/10 hover:bg-white/20" : "bg-zinc-100 hover:bg-zinc-200"}`}>
                                    📄 {a.fileName} · {kb(a.size)}
                                  </a>
                                ),
                              )}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  )}
                  <span className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-zinc-400">
                    {time(m.createdAt, p.tz)}{m.editedAt && !m.deleted ? " · edited" : ""}
                    {!m.deleted && editing?.id !== m.id && (mine || p.canModerate) && (
                      <span className="hidden gap-2 group-hover:flex group-focus-within:flex">
                        {mine && <button type="button" className="hover:text-zinc-700" onClick={() => setEditing({ id: m.id, text: m.body })}>Edit</button>}
                        {confirmDelete === m.id ? (
                          <>
                            <span className="text-red-600">Delete?</span>
                            <button type="button" className="font-medium text-red-600 hover:underline" onClick={() => void remove(m.id)}>Yes</button>
                            <button type="button" className="hover:text-zinc-700" onClick={() => setConfirmDelete(null)}>No</button>
                          </>
                        ) : (
                          <button type="button" className="hover:text-red-600" onClick={() => setConfirmDelete(m.id)}>Delete</button>
                        )}
                      </span>
                    )}
                  </span>
                  {openInfo === m.id && !m.deleted && (
                    <div className="mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-sm">
                      <p className="mb-1.5 font-medium text-zinc-700">Seen by {m.seenBy.length} of {Math.max(0, (info?.members.length ?? 1) - (info?.members.some((x) => x.id === m.senderId) ? 1 : 0))}</p>
                      {m.seenBy.length === 0 ? <p className="text-zinc-500">Nobody yet.</p> : (
                        <ul className="grid gap-1.5">
                          {m.seenBy.map((s) => (
                            <li key={s.id} className="flex items-center gap-2"><Avatar id={s.id} name={s.name} size="xs" /><span className="flex-1 truncate">{s.name}</span><span className="text-zinc-400">{time(s.at, p.tz)}</span></li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {latest && lastMine && latest.id === lastMine.id && (
          <div className="mt-1 flex items-center justify-end gap-1.5 pr-1 text-[11px] text-zinc-500">
            {info?.kind === "direct" ? (
              lastMine.seenBy.length ? <>Seen {time(lastMine.seenBy[0].at, p.tz)} <span className="text-green-600">✓✓</span></> : <>Sent <span>✓</span></>
            ) : lastMine.seenBy.length ? (
              <>
                <span className="flex -space-x-1">{lastMine.seenBy.slice(0, 5).map((s) => <Avatar key={s.id} id={s.id} name={s.name} size="xs" ring />)}</span>
                Seen by {lastMine.seenBy.length === others.length && others.length > 1 ? "everyone" : lastMine.seenBy.map((s) => s.name.split(" ")[0]).slice(0, 3).join(", ") + (lastMine.seenBy.length > 3 ? ` +${lastMine.seenBy.length - 3}` : "")}
              </>
            ) : <>Sent ✓</>}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {error && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
      <Composer {...p} members={info?.members ?? []} onSent={async () => { await load(); p.onActivity(); }} onError={setError} />
    </div>
  );
}

function Composer(p: ConversationProps & { members: Member[]; onSent: () => Promise<void>; onError: (m: string | null) => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<Linked[]>([]);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ q: string; at: number } | null>(null);
  const [picker, setPicker] = useState<"client" | "booking" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; label: string }[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const suggestions = mention ? p.members.filter((m) => m.id !== p.me.id && m.name.toLowerCase().includes(mention.q.toLowerCase())).slice(0, 6) : [];

  function onType(value: string) {
    setText(value);
    const caret = box.current?.selectionStart ?? value.length;
    const m = /(^|\s)@([\w .'-]{0,30})$/.exec(value.slice(0, caret));
    setMention(m ? { q: m[2], at: caret - m[2].length - 1 } : null);
    if (box.current) {
      box.current.style.height = "auto";
      box.current.style.height = `${Math.min(box.current.scrollHeight, 160)}px`;
    }
  }

  function pickMention(name: string) {
    if (!mention) return;
    const caret = box.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.at)}@${name} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => box.current?.focus());
  }

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) return setResults([]);
    try {
      if (picker === "client") {
        const rows = await api<{ id: string; name: string; phone: string }[]>(`/api/admin/clients/search?q=${encodeURIComponent(q)}`);
        setResults(rows.map((r) => ({ id: r.id, label: `${r.name} · ${r.phone}` })));
      } else if (picker === "booking" && q.trim().length >= 2) {
        const b = await api<{ id: string; reference: string; clientName: string }>(`/api/messages/booking?ref=${encodeURIComponent(q)}`);
        setResults([{ id: b.id, label: `${b.reference} · ${b.clientName}` }]);
      }
    } catch {
      setResults([]);
    }
  }

  async function send() {
    if (busy || (!text.trim() && !files.length && !links.length)) return;
    setBusy(true);
    const form = new FormData();
    form.set("body", text);
    for (const l of links) form.set(l.kind === "client" ? "clientId" : "bookingId", l.id);
    for (const f of files) form.append("files", f);
    try {
      await api(`/api/messages/${p.conversationId}`, { method: "POST", body: form });
      setText("");
      setFiles([]);
      setLinks([]);
      p.onError(null);
      if (box.current) box.current.style.height = "auto";
      await p.onSent();
    } catch (e) {
      p.onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative border-t border-zinc-200 bg-white px-3 py-2.5">
      {suggestions.length > 0 && (
        <ul className="absolute bottom-full left-3 mb-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg" role="listbox" aria-label="Mention someone">
          {suggestions.map((s) => (
            <li key={s.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(s.name); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50"><Avatar id={s.id} name={s.name} size="sm" />{s.name}</button></li>
          ))}
        </ul>
      )}
      {picker && (
        <div className="mb-2 rounded-xl border border-zinc-200 p-2">
          <div className="flex items-center gap-2">
            <input className="input flex-1 text-sm" autoFocus placeholder={picker === "client" ? "Search clients by name or phone" : `Booking ID, e.g. ${p.bookingPrefix}1007`} value={query} onChange={(e) => void search(e.target.value)} />
            <button type="button" className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100" onClick={() => { setPicker(null); setQuery(""); setResults([]); }}>Close</button>
          </div>
          {results.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}><button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50" onClick={() => { setLinks((l) => [...l.filter((x) => x.kind !== picker), { kind: picker, id: r.id, label: r.label }]); setPicker(null); setQuery(""); setResults([]); }}>{r.label}</button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(files.length > 0 || links.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {links.map((l) => <span key={l.kind} className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs">{l.kind === "client" ? "👤" : "📅"} {l.label}<button type="button" aria-label="Remove" className="ml-1 text-zinc-500 hover:text-black" onClick={() => setLinks((x) => x.filter((y) => y.kind !== l.kind))}>×</button></span>)}
          {files.map((f, i) => <span key={i} className="flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs">{f.type.startsWith("image/") ? "🖼" : "📄"} {f.name}<button type="button" aria-label="Remove" className="ml-1 text-zinc-500 hover:text-black" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>×</button></span>)}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <div className="flex shrink-0 items-center">
          <button type="button" title="Attach image or PDF (up to 5 MB)" aria-label="Attach file" className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-black" onClick={() => fileInput.current?.click()}>📎</button>
          {p.canLinkClients && <button type="button" title="Link a client" aria-label="Link a client" className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-black" onClick={() => { setPicker("client"); setResults([]); setQuery(""); }}>👤</button>}
          {p.canLinkBookings && <button type="button" title="Link a booking" aria-label="Link a booking" className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-black" onClick={() => { setPicker("booking"); setResults([]); setQuery(""); }}>📅</button>}
          <input ref={fileInput} type="file" className="hidden" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = ""; }} />
        </div>
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !suggestions.length) { e.preventDefault(); void send(); }
            if (e.key === "Enter" && suggestions.length) { e.preventDefault(); pickMention(suggestions[0].name); }
            if (e.key === "Escape") setMention(null);
          }}
          placeholder="Write a message. @ to mention, Shift+Enter for a new line"
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm outline-none focus:border-zinc-400 focus:bg-white"
          aria-label="Message"
        />
        <button type="button" onClick={() => void send()} disabled={busy} className="h-10 shrink-0 rounded-full bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50" aria-label="Send">
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
