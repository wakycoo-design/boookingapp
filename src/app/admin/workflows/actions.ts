"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { app } from "@/features/container";
import { isDomainError } from "@/features/shared/errors";
import { act } from "@/lib/form-actions";
import { requirePermission } from "@/lib/session";
import { kindOf } from "@/features/workflows/workflows.dto";
import { toWorkflowInput, type WorkflowInput } from "@/features/workflows/workflows.schemas";

export type SaveState = { error?: string } | null;

/** Returns the error to the form (instead of redirecting) so nothing the admin typed is lost. */
export async function saveWorkflowAction(id: string | null, _prev: SaveState, form: FormData): Promise<SaveState> {
  const me = await requirePermission("workflows", "edit");
  let tab = "notification";
  try {
    const input = JSON.parse(String(form.get("payload") ?? "{}")) as WorkflowInput;
    if (id) await app().workflows.update({ staffId: me.id }, id, input);
    else await app().workflows.create({ staffId: me.id }, input);
    tab = kindOf(input.action.channel);
  } catch (err) {
    if (isDomainError(err)) return { error: err.message };
    if (err instanceof ZodError) return { error: err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ") };
    if (err instanceof SyntaxError) return { error: "The form could not be read. Reload the page and try again." };
    throw err;
  }
  revalidatePath("/admin/workflows");
  redirect(`/admin/workflows?type=${tab}&ok=${encodeURIComponent("Workflow saved")}`);
}

export async function toggleWorkflowAction(id: string) {
  const me = await requirePermission("workflows", "edit");
  await act("/admin/workflows", "Saved", async () => {
    const w = await app().workflows.get(id);
    await app().workflows.update({ staffId: me.id }, id, { ...toWorkflowInput(w), active: !w.active });
    return `/admin/workflows?type=${kindOf(w.channel)}`;
  });
}

export async function deleteWorkflowAction(id: string) {
  const me = await requirePermission("workflows", "delete");
  await act("/admin/workflows", "Workflow deleted", async () => {
    const w = await app().workflows.get(id);
    await app().workflows.remove({ staffId: me.id }, id);
    return `/admin/workflows?type=${kindOf(w.channel)}`;
  });
}
