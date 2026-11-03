import { FEATURES } from "@/features/access/features";
import { ADMIN_ONLY } from "@/lib/settings-menu";
import { can, currentPermissions, currentStaff } from "@/lib/session";
import { SettingsNav } from "@/components/SettingsNav";

/** Settings is a small admin centre: a menu of sub-modules beside the page being edited. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [perms, me] = await Promise.all([currentPermissions(), currentStaff()]);
  const allowed = FEATURES.filter((f) => f.key.startsWith("settings.") && can(perms, f.key, "view")).map((f) => f.key);
  if (me?.role === "admin") allowed.push(ADMIN_ONLY);
  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <SettingsNav allowed={allowed} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
