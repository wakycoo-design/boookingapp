"use server";

import { app } from "@/features/container";
import { act, str } from "@/lib/form-actions";
import { requirePermission } from "@/lib/session";

const casePath = (clientId: string) => `/admin/case-histories/${clientId}`;

const noteFields = (form: FormData) => ({
  summary: str(form, "summary"),
  risk: str(form, "risk"),
  response: str(form, "response"),
  progress: str(form, "progress"),
  nextPlan: str(form, "nextPlan"),
  homework: str(form, "homework"),
  followUpOn: str(form, "followUpOn"),
});

export async function addNoteAction(clientId: string, form: FormData) {
  const me = await requirePermission("caseHistories", "add");
  const sign = form.get("intent") === "sign";
  await act(casePath(clientId), sign ? "Session note signed" : "Draft saved", async () => {
    const id = await app().caseHistory.addNote(me, clientId, { bookingId: str(form, "bookingId"), sessionOn: str(form, "sessionOn"), ...noteFields(form) });
    if (sign) await app().caseHistory.signNote(me, id);
  });
}

export async function updateDraftAction(clientId: string, noteId: string, form: FormData) {
  const me = await requirePermission("caseHistories", "edit");
  const sign = form.get("intent") === "sign";
  await act(casePath(clientId), sign ? "Session note signed" : "Draft saved", async () => {
    await app().caseHistory.updateDraft(me, noteId, noteFields(form));
    if (sign) await app().caseHistory.signNote(me, noteId);
  });
}

export async function deleteDraftAction(clientId: string, noteId: string) {
  const me = await requirePermission("caseHistories", "edit");
  await act(casePath(clientId), "Draft deleted", () => app().caseHistory.deleteDraft(me, noteId));
}

export async function addAddendumAction(clientId: string, noteId: string, form: FormData) {
  const me = await requirePermission("caseHistories", "add");
  await act(casePath(clientId), "Addendum added", () => app().caseHistory.addAddendum(me, noteId, { text: str(form, "text") }));
}

/** Saves one intake step and moves on to the next (or back to the case after the last). */
export async function saveIntakeAction(clientId: string, step: number, form: FormData) {
  const me = await requirePermission("caseHistories", "edit");
  const input = Object.fromEntries([...form.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string"));
  const next = step < 6 ? `${casePath(clientId)}/intake?step=${step + 1}` : casePath(clientId);
  await act(`${casePath(clientId)}/intake?step=${step}`, "Saved", async () => {
    await app().caseHistory.saveIntake(me, clientId, step, input);
    if (step === 6 && form.get("intent") === "complete") await app().caseHistory.completeIntake(me, clientId);
    return next;
  });
}

const DELIVERED: Record<string, string> = { sent: "sent", not_set_up: "isn't set up yet", no_contact: "has no address for this client", failed: "failed" };

export async function sendFollowUpAction(clientId: string, form: FormData) {
  const me = await requirePermission("caseHistories", "add");
  await act(casePath(clientId), "Follow-up sent", async () => {
    const r = await app().caseHistory.sendFollowUp(me, clientId, {
      suggestedOn: str(form, "suggestedOn"),
      partOfDay: str(form, "partOfDay"),
      note: str(form, "note"),
      whatsapp: form.get("whatsapp") === "on",
      email: form.get("email") === "on",
    });
    const parts = (["whatsapp", "email"] as const).filter((ch) => r[ch] !== "not_chosen").map((ch) => `${ch === "whatsapp" ? "WhatsApp" : "Email"} ${DELIVERED[r[ch]]}`);
    return `${casePath(clientId)}?${new URLSearchParams({ ok: `Follow-up recorded. ${parts.join("; ")}.` })}`;
  });
}
