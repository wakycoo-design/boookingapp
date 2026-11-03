"use server";

import { redirect } from "next/navigation";
import { app } from "@/features/container";
import { isDomainError } from "@/features/shared/errors";
import { requireStaff } from "@/lib/session";

const PAGE = "/admin/settings/users";
type By = { id: string; role: "admin" | "manager" | "staff" };

/** Runs one access change as the signed-in admin, then comes back to the list with what happened (or why not). */
async function run(ok: string, change: (by: By) => Promise<unknown>): Promise<never> {
  const me = await requireStaff("admin");
  try {
    await change({ id: me.id, role: me.role });
  } catch (err) {
    if (isDomainError(err)) redirect(`${PAGE}?${new URLSearchParams({ error: err.message })}`);
    throw err;
  }
  redirect(`${PAGE}?${new URLSearchParams({ ok })}`);
}

export async function deactivateUserAction(id: string, name: string) {
  await run(`${name} can no longer sign in`, (by) => app().staff.deactivate(by, id));
}

export async function reactivateUserAction(id: string, name: string) {
  await run(`${name} can sign in again`, (by) => app().staff.reactivate(by, id));
}

export async function signOutEverywhereAction(id: string, name: string) {
  await run(`${name} was signed out on every device`, (by) => app().staff.signOutEverywhere(by, id));
}

export async function terminateUserAction(id: string, name: string, form: FormData) {
  if (form.get("confirm") !== "on") redirect(`${PAGE}?${new URLSearchParams({ error: `Tick the box to confirm terminating ${name}` })}`);
  await run(`${name} was terminated: signed out, password removed and taken off all services`, (by) => app().staff.terminate(by, id));
}

export async function reinstateUserAction(id: string, name: string) {
  await run(`${name} was reinstated. Set a password or let them use Google/Zoho, and give them their services again`, (by) => app().staff.reinstate(by, id));
}

export async function setUserPasswordAction(id: string, name: string, form: FormData) {
  const password = String(form.get("password") ?? "");
  await run(`New password set for ${name}; they were signed out elsewhere. Share it with them privately`, (by) => app().staff.adminSetPassword(by, id, password));
}

/** Emails them a one-time link to choose their own password (works only when email sending is set up). */
export async function sendResetLinkAction(email: string, name: string) {
  await requireStaff("admin");
  const mail = await app().mail.status();
  if (!mail.configured) redirect(`${PAGE}?${new URLSearchParams({ error: "Email sending isn't set up, so no link can be sent. Set a password for them instead" })}`);
  await app().staff.requestPasswordReset(email);
  redirect(`${PAGE}?${new URLSearchParams({ ok: `A reset link was emailed to ${name} (it works for one hour)` })}`);
}
