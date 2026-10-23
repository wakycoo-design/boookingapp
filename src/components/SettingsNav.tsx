"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_GROUPS } from "@/lib/settings-menu";


/** `allowed`: the settings features this person may view; the others are left out of the menu. */
export function SettingsNav({ allowed }: { allowed: string[] }) {
  const path = usePathname();
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, links: g.links.filter((l) => allowed.includes(l.feature)) })).filter((g) => g.links.length);
  return (
    <nav aria-label="Settings" className="grid gap-5 text-sm">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">{g.title}</p>
          <ul className="grid gap-0.5">
            {g.links.map((l) => {
              const active = path === l.href || path.startsWith(`${l.href}/`);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-3 py-1.5 ${active ? "bg-zinc-100 font-medium text-black" : "text-zinc-600 hover:bg-zinc-50 hover:text-black"}`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
