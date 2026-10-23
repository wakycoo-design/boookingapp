import Link from "next/link";
import { app } from "@/features/container";
import { addDays } from "@/features/availability/slots";
import { can, requirePermission } from "@/lib/session";
import { zonedToUtc } from "@/lib/time";
import { BookingsTable } from "@/components/BookingsTable";
import { ColumnsManager } from "@/components/ColumnsManager";
import { columnChoices, columnPrefKey, resolveColumns } from "@/lib/booking-columns";
import { Icon } from "@/components/icons";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";

export const dynamic = "force-dynamic";

const VIEWS = [
  ["upcoming", "Upcoming"],
  ["past", "Past"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;
type View = (typeof VIEWS)[number][0];

const PAYMENTS = [["paid", "Paid"], ["pending", "Pending"], ["failed", "Failed"], ["not_required", "No payment due"]] as const;
const PACKAGES = [["has", "Has sessions left"], ["none", "No sessions left"]] as const;
const day = (v?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? "") ? v : undefined);
const oneOf = <T extends string>(list: readonly (readonly [T, string])[], v?: string) => list.find(([k]) => k === v)?.[0];

type Params = { view?: string; staff?: string; service?: string; payment?: string; package?: string; from?: string; to?: string; error?: string; ok?: string };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requirePermission("bookings", "view");
  // Without "view everyone's", only their own, whatever the address asks for.
  const seesAll = can(me.permissions, "bookings", "viewAll");
  const sp = await searchParams;
  const view: View = VIEWS.some(([v]) => v === sp.view) ? (sp.view as View) : "upcoming";
  // Staff see their own diary by default; anyone can switch to the whole firm (front desk).
  const staffFilter = !seesAll ? me.id : sp.staff === "all" ? null : sp.staff || null;
  const { bookings, catalog, staff, settings, preferences } = app();
  const [people, services, s, savedColumns] = await Promise.all([
    staff.list(),
    catalog.list(),
    settings.get(),
    preferences.get(me.id, columnPrefKey("bookings")),
  ]);

  const serviceId = services.find((x) => x.id === sp.service)?.id;
  const payment = oneOf(PAYMENTS, sp.payment);
  const packageBalance = oneOf(PACKAGES, sp.package);
  const fromDay = day(sp.from);
  const toDay = day(sp.to);
  // Whole days on the firm's clock: from the start of the first day to the last moment of the last.
  let from = fromDay ? zonedToUtc(`${fromDay}T00:00`, s.timezone) : null;
  let to = toDay ? new Date(zonedToUtc(`${addDays(toDay, 1)}T00:00`, s.timezone).getTime() - 1) : null;
  // The tab and the dates both apply: Upcoming never reaches back before now, Past never forward. Leaving the bound out lets the tab's own rule (now) stand.
  const now = new Date();
  if (view === "upcoming" && from && from <= now) from = null;
  if (view === "past" && to && to >= now) to = null;

  const rows = await bookings.list({
    view,
    staffId: staffFilter,
    serviceId,
    paymentStatus: payment,
    packageBalance,
    from,
    to,
    limit: 200,
  });
  const columns = resolveColumns(savedColumns, "bookings");
  const active = [serviceId, payment, packageBalance, fromDay, toDay, staffFilter && seesAll ? staffFilter : undefined].filter(Boolean).length;
  const keep = { staff: staffFilter ?? "all", service: serviceId, payment, package: packageBalance, from: fromDay, to: toDay };
  const link = (v: View) => `/admin/bookings?${new URLSearchParams({ view: v, ...Object.fromEntries(Object.entries(keep).filter(([, x]) => x)) as Record<string, string> })}`;

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle="See upcoming and past appointments, or book one for a client."
        action={<Link href="/admin/bookings/new" className="btn"><Icon name="plus" /> New booking</Link>}
      />
      <Notice error={sp.error} ok={sp.ok} />
      {/* The Filters button is a label for a hidden checkbox, so the panel opens and closes without any script. It stays open while filters are on. */}
      <div>
        <input type="checkbox" id="show-filters" className="peer sr-only" defaultChecked={active > 0} />
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <nav className="tabs !mb-0" aria-label="Booking views">
            {VIEWS.map(([v, label]) => (
              <Link key={v} href={link(v)} className={`tab ${v === view ? "tab-active" : ""}`}>{label}</Link>
            ))}
          </nav>
          <div className="flex gap-2">
            <label htmlFor="show-filters" className={`btn-ghost cursor-pointer ${active > 0 ? "!border-black" : ""}`}>
              Filters{active > 0 ? ` · ${active}` : ""}
            </label>
            <ColumnsManager list="bookings" choices={columnChoices(columns)} />
          </div>
        </div>

        <form className="card mb-4 hidden items-end gap-3 p-4 peer-checked:grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" action="/admin/bookings">
          <input type="hidden" name="view" value={view} />
          <div><label className="label !text-xs" htmlFor="from">From</label><input className="input" id="from" name="from" type="date" defaultValue={fromDay} /></div>
          <div><label className="label !text-xs" htmlFor="to">To</label><input className="input" id="to" name="to" type="date" defaultValue={toDay} /></div>
          <div>
            <label className="label !text-xs" htmlFor="staff">Therapist</label>
            <select className="input" id="staff" name="staff" defaultValue={staffFilter ?? "all"}>
              <option value="all">Everyone</option>
              {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.id === me.id ? `${p.name} (me)` : p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label !text-xs" htmlFor="service">Service</label>
            <select className="input" id="service" name="service" defaultValue={serviceId ?? ""}>
              <option value="">Any service</option>
              {services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label !text-xs" htmlFor="package">Client&apos;s package</label>
            <select className="input" id="package" name="package" defaultValue={packageBalance ?? ""}>
              <option value="">Any</option>
              {PACKAGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="label !text-xs" htmlFor="payment">Payment</label>
            <select className="input" id="payment" name="payment" defaultValue={payment ?? ""}>
              <option value="">Any</option>
              {PAYMENTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn" type="submit">Apply</button>
            {active > 0 && <Link className="btn-ghost" href={`/admin/bookings?view=${view}`}>Clear</Link>}
          </div>
        </form>
      </div>
      <p className="mb-2 text-xs text-zinc-400">
        {rows.length} booking{rows.length === 1 ? "" : "s"}{active > 0 ? ` · ${active} filter${active === 1 ? "" : "s"} on` : ""}
        {rows.length === 200 ? " · showing the first 200, narrow the filters to see others" : ""}
      </p>

      <BookingsTable rows={rows} columns={columns} tz={s.timezone} prefix={s.bookingPrefix} empty={active > 0 ? "No bookings match these filters." : view === "all" ? "No bookings yet." : `No ${view} bookings.`} />
    </>
  );
}
