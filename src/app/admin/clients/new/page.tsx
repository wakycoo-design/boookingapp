import Link from "next/link";
import { app } from "@/features/container";
import { requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PhoneField } from "@/components/PhoneField";
import { PageHeader } from "@/components/Shell";
import { createClientAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requirePermission("clients", "add");
  const { error } = await searchParams;
  const team = (await app().staff.list()).filter((m) => m.active);
  return (
    <>
      <Link href="/admin/clients" className="text-sm text-zinc-600 hover:text-black">← Clients</Link>
      <div className="mt-4">
        <PageHeader title="New client" subtitle="Add a client before their first booking. You can fill in the rest of their details afterwards." />
      </div>
      <Notice error={error} />
      <form action={createClientAction} className="card grid max-w-2xl gap-4 p-5 sm:grid-cols-2">
        <div><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" required autoComplete="off" /></div>
        <PhoneField id="phone" name="phone" label="Mobile number" required />
        <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" placeholder="Optional" /></div>
        <div>
          <label className="label" htmlFor="staffId">Therapist</label>
          <select className="input" id="staffId" name="staffId" defaultValue="">
            <option value="">Assign later</option>
            {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.designation ? ` · ${m.designation}` : ""}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <input type="checkbox" className="toggle" name="whatsappOptIn" defaultChecked /> Send WhatsApp updates
        </label>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">Front-desk notes</label>
          <textarea className="input" id="notes" name="notes" rows={2} placeholder="Non-clinical, e.g. prefers evenings" />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn" type="submit">Add client</button>
          <Link href="/admin/clients" className="btn-ghost">Cancel</Link>
        </div>
      </form>
    </>
  );
}
