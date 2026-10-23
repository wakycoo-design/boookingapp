import { app } from "@/features/container";
import { requireStaff } from "@/lib/session";
import { HoursEditor } from "@/components/HoursEditor";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { saveSettingsAction } from "../../actions";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function OrganizationSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  await requireStaff("admin");
  const { error, ok } = await searchParams;
  const s = await app().settings.get();
  return (
    <>
      <PageHeader title="Basic information" subtitle="Who the firm is and how to reach it." />
      <Notice error={error} ok={ok} />
      <form action={saveSettingsAction.bind(null, "organization")} className="grid max-w-3xl gap-6">
        <section className="card grid gap-4 p-6 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Organization</h2>
          <div><label className="label" htmlFor="name">Business name</label><input className="input" id="name" name="name" defaultValue={s.name} required /></div>
          <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" defaultValue={s.email ?? ""} placeholder="hello@yourfirm.com" /></div>
          <div><label className="label" htmlFor="phone">Contact number</label><input className="input" id="phone" name="phone" type="tel" defaultValue={s.phone ?? ""} placeholder="+91 98765 43210" /></div>
          <div><label className="label" htmlFor="logoUrl">Logo web address</label><input className="input" id="logoUrl" name="logoUrl" defaultValue={s.logoUrl ?? ""} placeholder="https://yourfirm.com/logo.png" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="address">Address</label><textarea className="input" id="address" name="address" rows={2} defaultValue={s.address ?? ""} /></div>
        </section>
        <section className="card grid gap-4 p-6 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Region</h2>
          <div><label className="label" htmlFor="timezone">Time zone</label><TimezoneSelect value={s.timezone} /></div>
          <div><label className="label" htmlFor="currency">Currency</label><input className="input" id="currency" name="currency" defaultValue={s.currency} maxLength={3} required /></div>
          <div>
            <label className="label" htmlFor="weekStart">Week starts on</label>
            <select className="input" id="weekStart" name="weekStart" defaultValue={String(s.weekStart)}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="timeFormat">Time format</label>
            <select className="input" id="timeFormat" name="timeFormat" defaultValue={s.timeFormat}>
              <option value="12h">12 hours (2:30 pm)</option>
              <option value="24h">24 hours (14:30)</option>
            </select>
          </div>
        </section>
        <section className="card grid gap-4 p-6">
          <div>
            <h2 className="font-semibold">Business hours</h2>
            <p className="mt-1 text-sm text-zinc-600">
              The firm&apos;s general opening times, covering every shift. They are for information only: each therapist is booked only within their own hours (Staff, their name).
            </p>
          </div>
          <HoursEditor initial={s.businessHours} />
        </section>
        <div><button className="btn" type="submit">Save</button></div>
      </form>
    </>
  );
}
