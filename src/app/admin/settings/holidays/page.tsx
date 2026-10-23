import Link from "next/link";
import { app } from "@/features/container";
import { requireStaff } from "@/lib/session";
import { isoDay, longDayLabel } from "@/lib/format";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { addHolidayAction, removeHolidayAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireStaff("admin");
  const { error, ok } = await searchParams;
  const s = await app().settings.get();
  const today = isoDay(new Date(), s.timezone);
  const holidays = await app().holidays.list(today);
  return (
    <>
      <PageHeader
        title="Holidays"
        subtitle="Days the whole firm is closed. No one can be booked on these dates."
      />
      <Notice error={error} ok={ok} />
      <div className="grid max-w-3xl gap-6">
        <section className="card p-6">
          <h2 className="mb-4 font-semibold">Add a holiday</h2>
          <form action={addHolidayAction} className="flex flex-wrap items-end gap-3">
            <div><label className="label" htmlFor="date">Date</label><input className="input" id="date" name="date" type="date" min={today} required /></div>
            <div className="min-w-56 flex-1"><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" placeholder="e.g. Diwali" required /></div>
            <button className="btn" type="submit">Add</button>
          </form>
        </section>
        <section className="card p-6">
          <h2 className="mb-4 font-semibold">Coming up</h2>
          {!holidays.length && <p className="text-sm text-zinc-600">No holidays set.</p>}
          <ul className="divide-y divide-zinc-100">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span><span className="font-medium">{h.name}</span><span className="block text-xs text-zinc-600">{longDayLabel(new Date(`${h.date}T12:00:00Z`), "UTC")}</span></span>
                <form action={removeHolidayAction.bind(null, h.id)}><button className="btn-ghost" type="submit">Remove</button></form>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
