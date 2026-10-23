import Link from "next/link";
import { app } from "@/features/container";
import { isUuid } from "@/features/shared/validation";
import { addDays } from "@/features/availability/slots";
import { can, requirePermission } from "@/lib/session";
import { zonedToUtc } from "@/lib/time";
import { isoDay, longDayLabel, timeLabel } from "@/lib/format";
import { ClientFields } from "@/components/ClientFields";
import { AutoSubmitForm } from "@/components/AutoSubmitForm";
import { Icon } from "@/components/icons";
import { QuestionFields } from "@/components/QuestionFields";
import { groupByPart } from "@/lib/day-parts";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { createBookingAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; staff?: string; date?: string; start?: string; client?: string; error?: string }>;
}) {
  const me = await requirePermission("bookings", "add");
  const sp = await searchParams;
  const { catalog, staff, availability, settings } = app();
  const [services, s] = await Promise.all([catalog.list({ activeOnly: true }), settings.get()]);
  const tz = s.timezone;
  const serviceId = sp.service && services.some((x) => x.id === sp.service) ? sp.service : services[0]?.id;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : isoDay(new Date(), tz);
  const people = serviceId ? await staff.listBookableForService(serviceId) : [];
  const staffId = sp.staff && people.some((p) => p.id === sp.staff) ? sp.staff : "";
  const svc = services.find((x) => x.id === serviceId);
  // Opened from a client's page: their details fill the form. Only for managers, who can already search clients here.
  const client = sp.client && isUuid(sp.client) && can(me.permissions, "clients", "view") ? await app().clients.get(sp.client).catch(() => null) : null;

  const slots = serviceId && people.length
    ? (
        await availability.slots(
          { serviceId, staffId: staffId || null, from: zonedToUtc(`${date}T00:00`, tz), to: zonedToUtc(`${addDays(date, 1)}T00:00`, tz) },
          { mode: "staff" },
        )
      ).slots
    : [];
  const chosen = sp.start ? slots.find((x) => x.start.toISOString() === sp.start) ?? null : null;
  const href = (patch: Record<string, string>) =>
    `/admin/bookings/new?${new URLSearchParams({ service: serviceId ?? "", staff: staffId, date, ...(client ? { client: client.id } : {}), ...patch })}`;

  if (!services.length) {
    return (
      <>
        <PageHeader title="New booking" />
        <p className="card p-6 text-sm text-zinc-600">Add a service first, then give it to at least one staff member.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New booking" subtitle={`Times are in ${tz}.`} />
      <Notice error={sp.error} />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <AutoSubmitForm className="card grid content-start gap-4 p-5" action="/admin/bookings/new">
          {client && <input type="hidden" name="client" value={client.id} />}
          <div>
            <label className="label" htmlFor="service">Service</label>
            <select className="input" id="service" name="service" defaultValue={serviceId}>
              {services.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.durationMin} min</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="staff">With</label>
            <select className="input" id="staff" name="staff" defaultValue={staffId}>
              <option value="">Anyone available</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="date">Date</label><input className="input" id="date" name="date" type="date" defaultValue={date} /></div>
          <noscript><button className="btn-ghost justify-center" type="submit">Show times</button></noscript>
        </AutoSubmitForm>

        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <Link className="icon-btn" href={href({ date: addDays(date, -1) })} aria-label="Previous day">‹</Link>
            <h2 className="text-center font-medium">{longDayLabel(new Date(`${date}T12:00:00Z`), "UTC")}</h2>
            <Link className="icon-btn" href={href({ date: addDays(date, 1) })} aria-label="Next day">›</Link>
          </div>
          {!people.length && <p className="text-sm text-zinc-600">Nobody offers {svc?.name} yet. Give it to a staff member on the Staff page.</p>}
          {people.length > 0 && slots.length === 0 && <p className="text-sm text-zinc-600">No free times this day. Try another date.</p>}
          <div className="grid gap-5">
            {groupByPart(slots, tz).map((part) => (
              <div key={part.id}>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-600"><Icon name={part.icon} className="h-4 w-4 text-black" />{part.label}</h3>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                  {part.slots.map((x) => {
                    const iso = x.start.toISOString();
                    const active = iso === sp.start;
                    return (
                      <Link
                        key={iso}
                        href={href({ start: iso })}
                        className={`rounded-md border px-2 py-2 text-center text-sm transition-colors ${active ? "border-black bg-black text-white" : "border-zinc-200 hover:border-zinc-500"}`}
                      >
                        {timeLabel(x.start, tz)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {chosen && svc && (
            <form action={createBookingAction} className="mt-8 grid gap-4 border-t border-zinc-200 pt-6 sm:grid-cols-2">
              <p className="text-sm text-zinc-600 sm:col-span-2">
                {svc.name} on {longDayLabel(chosen.start, tz)} at {timeLabel(chosen.start, tz)}
                {staffId ? ` with ${people.find((p) => p.id === staffId)?.name}` : chosen.staffIds.length > 1 ? " (we'll pick whoever is least busy)" : ` with ${people.find((p) => p.id === chosen.staffIds[0])?.name}`}
              </p>
              <input type="hidden" name="serviceId" value={svc.id} />
              <input type="hidden" name="staffId" value={staffId} />
              <input type="hidden" name="start" value={chosen.start.toISOString()} />
              <input type="hidden" name="date" value={date} />
              <ClientFields canSearch={can(me.permissions, "clients", "view")} initial={client && { id: client.id, name: client.name, phone: client.phoneE164, email: client.email, whatsappOptIn: client.whatsappOptIn }} />
              <QuestionFields questions={svc.questions} />
              <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea className="input" id="notes" name="notes" rows={2} placeholder="Only staff see these" /></div>
              <div className="sm:col-span-2"><button className="btn-success" type="submit">Confirm booking</button></div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
