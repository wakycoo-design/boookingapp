"use client";

/** Small shared pieces for the team messages screens. */

const PALETTE = ["bg-emerald-600", "bg-sky-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-teal-600", "bg-indigo-600", "bg-orange-600"];

/** The same person always gets the same colour. */
export function colourFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function Avatar({ id, name, size = "md", ring = false }: { id: string; name: string; size?: "xs" | "sm" | "md"; ring?: boolean }) {
  const s = size === "xs" ? "h-4 w-4 text-[8px]" : size === "sm" ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span className={`inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ${colourFor(id)} ${s} ${ring ? "ring-2 ring-white" : ""}`} title={name} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Icon for a conversation that isn't one person: Everyone, a role or a group. */
export function GroupBadge({ kind }: { kind: "group" | "everyone" | "role" }) {
  const glyph = kind === "everyone" ? "★" : kind === "role" ? "◆" : "#";
  const tone = kind === "everyone" ? "bg-zinc-900" : kind === "role" ? "bg-green-700" : "bg-zinc-500";
  return <span className={`inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white ${tone}`} aria-hidden="true">{glyph}</span>;
}

export function relativeTime(iso: string | Date, tz: string) {
  const d = new Date(iso);
  const now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...o }).format(d);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  if (day(d) === day(now)) return fmt({ hour: "numeric", minute: "2-digit", hour12: true });
  const y = new Date(now.getTime() - 86_400_000);
  if (day(d) === day(y)) return "Yesterday";
  return fmt({ day: "numeric", month: "short" });
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? "Something went wrong");
  return json.data as T;
}

/** Calls `fn` now and then every `ms` while the tab is visible (and once more when it becomes visible again). */
export function startPolling(fn: () => void, ms: number) {
  fn();
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") fn();
  }, ms);
  const onShow = () => document.visibilityState === "visible" && fn();
  document.addEventListener("visibilitychange", onShow);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onShow);
  };
}
