import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { app } from "@/features/container";
import type { CaseRecordDTO, IntakeFields } from "@/features/case-history/case-history.dto";
import { AFFECT, COOPERATION, INSIGHT, JUDGEMENT, LABEL, ONSET, RAPPORT, RISK, SEVERITY } from "@/features/case-history/choices";
import { ICD11 } from "@/features/case-history/icd11";
import { clientReference } from "@/features/clients/clients.dto";
import { isDomainError } from "@/features/shared/errors";
import { requirePermission } from "@/lib/session";
import { Notice } from "@/components/Notice";
import { saveIntakeAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intake" };

const STEPS = ["Presenting problem", "History", "Personal history", "Mental status", "Risk and diagnosis", "Plan"] as const;

type Field =
  | { kind: "text"; name: keyof IntakeFields; label: string; rows?: number; hint?: string; wide?: boolean }
  | { kind: "line"; name: keyof IntakeFields; label: string; hint?: string }
  | { kind: "choice"; name: keyof IntakeFields; label: string; values: readonly string[] };

const FIELDS: Record<number, Field[]> = {
  1: [
    { kind: "text", name: "presentingComplaints", label: "Presenting complaints", rows: 4, hint: "In the client's own words, with how long each has lasted.", wide: true },
    { kind: "choice", name: "onset", label: "Onset", values: ONSET },
    { kind: "line", name: "duration", label: "Duration", hint: "e.g. 6 months" },
    { kind: "choice", name: "severity", label: "Severity", values: SEVERITY },
    { kind: "text", name: "historyPresent", label: "History of the present problem", rows: 5, hint: "Onset, course, triggers, what has been tried.", wide: true },
  ],
  2: [
    { kind: "text", name: "pastPsychiatric", label: "Past psychiatric history", wide: true },
    { kind: "text", name: "medicalHistory", label: "Medical history", wide: true },
    { kind: "text", name: "medication", label: "Current medication", rows: 2, wide: true },
    { kind: "text", name: "familyHistory", label: "Family history", hint: "Mental illness in the family, family relationships.", wide: true },
  ],
  3: [
    { kind: "text", name: "personalHistory", label: "Personal history", rows: 5, hint: "Birth and development, education, work, relationships and marriage.", wide: true },
    { kind: "text", name: "substanceUse", label: "Substance use", rows: 2, wide: true },
    { kind: "text", name: "premorbidPersonality", label: "Premorbid personality", rows: 2, hint: "What they were like before the problem began.", wide: true },
  ],
  4: [
    { kind: "line", name: "mseAppearance", label: "Appearance" },
    { kind: "choice", name: "mseCooperation", label: "Behaviour and cooperation", values: COOPERATION },
    { kind: "choice", name: "mseRapport", label: "Rapport", values: RAPPORT },
    { kind: "line", name: "mseSpeech", label: "Speech" },
    { kind: "line", name: "mseMood", label: "Mood (client's words)" },
    { kind: "choice", name: "mseAffect", label: "Affect", values: AFFECT },
    { kind: "text", name: "mseThought", label: "Thought (form and content)", rows: 2, wide: true },
    { kind: "text", name: "msePerception", label: "Perception", rows: 2, wide: true },
    { kind: "text", name: "mseCognition", label: "Cognition", rows: 2, wide: true },
    { kind: "choice", name: "mseInsight", label: "Insight", values: INSIGHT },
    { kind: "choice", name: "mseJudgement", label: "Judgement", values: JUDGEMENT },
  ],
  5: [
    { kind: "choice", name: "riskSuicide", label: "Suicide risk", values: RISK },
    { kind: "choice", name: "riskSelfHarm", label: "Self-harm risk", values: RISK },
    { kind: "choice", name: "riskOthers", label: "Risk to others", values: RISK },
    { kind: "line", name: "diagnosisSecondary", label: "Secondary diagnosis" },
    { kind: "line", name: "diagnosisSpecifiers", label: "Specifiers", hint: "e.g. moderate, with anxious distress" },
    { kind: "text", name: "formulation", label: "Case formulation", rows: 5, hint: "Predisposing, precipitating, perpetuating and protective factors.", wide: true },
  ],
  6: [
    { kind: "text", name: "goalsShort", label: "Short-term goals", rows: 3, wide: true },
    { kind: "text", name: "goalsLong", label: "Long-term goals", rows: 3, wide: true },
    { kind: "line", name: "approach", label: "Approach", hint: "e.g. CBT" },
    { kind: "line", name: "frequency", label: "Frequency", hint: "e.g. weekly, 12 sessions" },
    { kind: "text", name: "planNotes", label: "Plan notes", rows: 3, wide: true },
  ],
};

export default async function IntakePage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ step?: string; ok?: string; error?: string }> }) {
  const me = await requirePermission("caseHistories", "view");
  const { clientId } = await params;
  const sp = await searchParams;
  const step = Math.min(6, Math.max(1, Number(sp.step) || 1));
  let r: CaseRecordDTO;
  try {
    r = await app().caseHistory.open(me, clientId);
  } catch (err) {
    if (isDomainError(err) && err.code === "not_found") notFound();
    if (isDomainError(err) && err.code === "forbidden") redirect(`/admin/case-histories/${clientId}`);
    throw err;
  }
  const c = await app().clients.get(clientId);
  const value = (name: keyof IntakeFields) => (r[name] as string | null) ?? "";

  return (
    <>
      <Link href={`/admin/case-histories/${clientId}`} className="text-sm text-zinc-600 hover:text-black">← {c.name}&apos;s case history</Link>
      <div className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">Intake</h1>
        <p className="mt-1 text-sm text-zinc-600">{c.name} · <span className="font-mono">{clientReference(c.number)}</span> · each step saves on its own</p>
      </div>
      <Notice ok={sp.ok} error={sp.error} />

      <nav className="mb-6 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Intake steps">
        {STEPS.map((label, i) => (
          <Link key={label} href={`?step=${i + 1}`} aria-current={step === i + 1 ? "step" : undefined}
            className={`rounded-lg border px-3 py-2 text-sm ${step === i + 1 ? "border-black bg-black text-white" : "border-zinc-200 text-zinc-700 hover:border-zinc-400"}`}>
            <span className={`block text-[11px] uppercase tracking-wider ${step === i + 1 ? "text-zinc-300" : "text-zinc-500"}`}>Step {i + 1}</span>
            {label}
          </Link>
        ))}
      </nav>

      <form action={saveIntakeAction.bind(null, clientId, step)} className="card grid max-w-4xl gap-4 p-5 sm:grid-cols-3">
        <h2 className="font-semibold sm:col-span-3">Step {step}: {STEPS[step - 1]}</h2>
        {step === 5 && (
          <div className="sm:col-span-3">
            <label className="label" htmlFor="diagnosisCode">Primary diagnosis (ICD-11)</label>
            <select className="input" id="diagnosisCode" name="diagnosisCode" defaultValue={r.diagnosisCode ?? (r.diagnosisLabel ? "other" : "")}>
              <option value="">Not yet diagnosed</option>
              {ICD11.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.title}</option>)}
              <option value="other">Other (write it below)</option>
            </select>
            <label className="label mt-3" htmlFor="diagnosisLabel">Diagnosis, if Other</label>
            <input className="input" id="diagnosisLabel" name="diagnosisLabel" defaultValue={r.diagnosisCode ? "" : r.diagnosisLabel ?? ""} />
          </div>
        )}
        {FIELDS[step].map((f) => (
          <div key={f.name} className={f.kind === "text" && f.wide ? "sm:col-span-3" : ""}>
            <label className="label" htmlFor={f.name}>{f.label}</label>
            {f.kind === "text" && <textarea className="input" id={f.name} name={f.name} rows={f.rows ?? 3} defaultValue={value(f.name)} />}
            {f.kind === "line" && <input className="input" id={f.name} name={f.name} defaultValue={value(f.name)} />}
            {f.kind === "choice" && (
              <select className="input" id={f.name} name={f.name} defaultValue={value(f.name)}>
                <option value="">Not recorded</option>
                {f.values.map((x) => <option key={x} value={x}>{LABEL[x]}</option>)}
              </select>
            )}
            {"hint" in f && f.hint && <p className="mt-1.5 text-xs text-zinc-600">{f.hint}</p>}
          </div>
        ))}
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <button className="btn" type="submit" name="intent" value="save">{step < 6 ? "Save and continue" : "Save"}</button>
          {step === 6 && r.status === "intake_pending" && <button className="btn-ghost" type="submit" name="intent" value="complete">Save and mark intake complete</button>}
          {step > 1 && <Link className="btn-ghost" href={`?step=${step - 1}`}>Back</Link>}
        </div>
      </form>
    </>
  );
}
