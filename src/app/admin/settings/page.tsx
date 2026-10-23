import { redirect } from "next/navigation";
import { SETTINGS_GROUPS } from "@/lib/settings-menu";
import { can, currentPermissions } from "@/lib/session";

/** Opens the first settings page this person may see. */
export default async function SettingsPage() {
  const perms = await currentPermissions();
  const first = SETTINGS_GROUPS.flatMap((g) => g.links).find((l) => can(perms, l.feature, "view"));
  redirect(first?.href ?? "/?error=forbidden");
}
