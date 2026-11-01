import type { CaseStatus } from "@/features/case-history/case-history.dto";
import { LABEL, type Risk } from "@/features/case-history/choices";

// Red only where it marks something a clinician must notice (high risk), per the app's colour rule. The reassuring
// ratings (none, low) get only a faint green outline and moderate a faint yellow one, so each reads at a glance
// without competing with the red.
const riskTone: Record<Risk, string> = {
  high: "border-red-300 bg-red-50 font-medium text-red-700",
  moderate: "border-yellow-400 text-yellow-800",
  low: "border-green-300 text-green-700",
  none: "border-green-300 text-green-700",
};

export function RiskBadge({ risk, prefix }: { risk: Risk | null; prefix?: string }) {
  if (!risk) return <span className="text-sm text-zinc-500">—</span>;
  return <span className={`badge ${riskTone[risk]}`}>{prefix}{LABEL[risk]}</span>;
}

const statusTone: Record<CaseStatus, string> = {
  intake_pending: "border-dashed border-zinc-400 text-zinc-700",
  in_treatment: "",
  concluded: "border-green-300 text-green-700",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge ${statusTone[status]}`}>{LABEL[status]}</span>;
}

/** Stands in for a profile picture until staff have photos. */
export function Initials({ name, muted = false, size = "sm" }: { name: string; muted?: boolean; size?: "sm" | "md" }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const box = size === "md" ? "h-9 w-9 text-xs" : "h-6 w-6 text-[10px]";
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full font-semibold ${box} ${muted ? "border border-dashed border-zinc-400 text-zinc-600" : "bg-black text-white"}`}>
      {letters}
    </span>
  );
}
