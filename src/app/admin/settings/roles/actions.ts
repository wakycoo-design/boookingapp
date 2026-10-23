"use server";

import { app } from "@/features/container";
import { act, str } from "@/lib/form-actions";
import { requirePermission } from "@/lib/session";

const PATH = "/admin/settings/roles";

export async function saveRolePermissionsAction(roleId: string, form: FormData) {
  const me = await requirePermission("settings.roles", "edit");
  // Ticked boxes are named "p:<feature>:<action>".
  const ticked = [...form.keys()].filter((k) => k.startsWith("p:")).map((k) => k.slice(2));
  await act(`${PATH}?role=${roleId}`, "Permissions saved", () => app().access.saveMatrix({ staffId: me.id }, roleId, ticked));
}

export async function createRoleAction(form: FormData) {
  const me = await requirePermission("settings.roles", "edit");
  await act(PATH, "Role added", async () => {
    const id = await app().access.createRole({ staffId: me.id }, { name: str(form, "name"), copyFrom: str(form, "copyFrom") });
    return `${PATH}?role=${id}`;
  });
}

export async function renameRoleAction(roleId: string, form: FormData) {
  const me = await requirePermission("settings.roles", "edit");
  await act(`${PATH}?role=${roleId}`, "Role renamed", () => app().access.renameRole({ staffId: me.id }, roleId, str(form, "name")));
}

export async function deleteRoleAction(roleId: string) {
  const me = await requirePermission("settings.roles", "edit");
  await act(`${PATH}?role=${roleId}`, "Role deleted", async () => {
    await app().access.removeRole({ staffId: me.id }, roleId);
    return PATH;
  });
}
