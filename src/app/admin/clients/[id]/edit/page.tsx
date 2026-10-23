import Link from "next/link";
import { notFound } from "next/navigation";
import { app } from "@/features/container";
import { clientReference } from "@/features/clients/clients.dto";
import { isDomainError } from "@/features/shared/errors";
import { isoDay, phoneLabel } from "@/lib/format";
import { requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { PhoneField } from "@/components/PhoneField";
import { PageHeader } from "@/components/Shell";
import { updateClientProfileAction } from "../../../actions";

export const dynamic = "force-dynamic";

const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];
const MARITAL = ["Single", "Married", "Divorced", "Widowed", "Separated", "Other"];

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requirePermission("clients", "edit");
  const { id } = await params;
  const { error } = await searchParams;
  const c = await app().clients.get(id).catch((err) => {
    if (isDomainError(err)) notFound();
    throw err;
  });
  const tz = (await app().settings.get()).timezone;
  const today = isoDay(new Date(), tz);

  const text = (name: keyof typeof c, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input className="input" id={name} name={name} defaultValue={(c[name] as string | null) ?? ""} {...props} />
    </div>
  );
  const choice = (name: "gender" | "maritalStatus", label: string, options: string[]) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select className="input" id={name} name={name} defaultValue={c[name] ?? ""}>
        <option value="">Not recorded</option>
        {/* Keep a value typed before these options existed. */}
        {c[name] && !options.includes(c[name]!) && <option value={c[name]!}>{c[name]}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <>
      <Link href={`/admin/clients/${id}`} className="text-sm text-zinc-600 hover:text-black">← {c.name}</Link>
      <div className="mt-4">
        <PageHeader title="Edit client" subtitle={`${clientReference(c.number)} · ${phoneLabel(c.phoneE164)}`} />
      </div>
      <Notice error={error} />
      <form action={updateClientProfileAction.bind(null, id)} className="grid max-w-3xl gap-8">
        <fieldset className="card grid gap-4 p-5 sm:grid-cols-2">
          <legend className="sr-only">Contact</legend>
          <h2 className="font-semibold sm:col-span-2">Contact</h2>
          {text("name", "Name", { required: true })}
          {text("email", "Email", { type: "email" })}
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <input type="checkbox" className="toggle" name="whatsappOptIn" defaultChecked={c.whatsappOptIn} /> WhatsApp updates
          </label>
        </fieldset>

        <fieldset className="card grid gap-4 p-5 sm:grid-cols-2">
          <legend className="sr-only">Personal</legend>
          <h2 className="font-semibold sm:col-span-2">Personal</h2>
          {text("dateOfBirth", "Date of birth", { type: "date", min: "1900-01-01", max: today })}
          {choice("gender", "Gender", GENDERS)}
          {choice("maritalStatus", "Marital status", MARITAL)}
          {text("occupation", "Occupation")}
          {text("education", "Education")}
          {text("location", "Location", { placeholder: "City, state" })}
          {text("languages", "Languages", { placeholder: "e.g. Malayalam, English" })}
        </fieldset>

        <fieldset className="card grid gap-4 p-5 sm:grid-cols-3">
          <legend className="sr-only">Emergency contact</legend>
          <h2 className="font-semibold sm:col-span-3">Emergency contact</h2>
          {text("emergencyName", "Name")}
          {text("emergencyRelation", "Relation", { placeholder: "e.g. Spouse" })}
          <PhoneField id="emergencyPhone" name="emergencyPhone" label="Phone" defaultValue={c.emergencyPhone} />
        </fieldset>

        <fieldset className="card grid gap-4 p-5 sm:grid-cols-2">
          <legend className="sr-only">Registration</legend>
          <h2 className="font-semibold sm:col-span-2">Registration</h2>
          {text("referralSource", "How they found us", { placeholder: "e.g. Instagram, a friend" })}
          <div>
            <label className="label" htmlFor="consentSignedAt">Therapy consent signed on</label>
            <input className="input" id="consentSignedAt" name="consentSignedAt" type="date" max={today} defaultValue={c.consentSignedAt ? isoDay(c.consentSignedAt, tz) : ""} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="notes">Front-desk notes</label>
            <textarea className="input" id="notes" name="notes" rows={3} defaultValue={c.notes ?? ""} />
            <p className="mt-1.5 text-xs text-zinc-600">Non-clinical only, such as scheduling or payment remarks. Every staff member who can open this client sees it.</p>
          </div>
        </fieldset>

        <div className="flex gap-3">
          <button className="btn" type="submit">Save</button>
          <Link href={`/admin/clients/${id}`} className="btn-ghost">Cancel</Link>
        </div>
      </form>
    </>
  );
}
