import { SettingsNav } from "@/components/SettingsNav";

/** Settings is a small admin centre: a menu of sub-modules beside the page being edited. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <SettingsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
