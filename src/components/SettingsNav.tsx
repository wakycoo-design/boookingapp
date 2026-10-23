"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The settings sub-modules, grouped like an admin centre. */
const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Organization",
    links: [
      { href: "/admin/settings/organization", label: "Basic information" },
      { href: "/admin/settings/holidays", label: "Holidays" },
    ],
  },
  {
    title: "Bookings",
    links: [
      { href: "/admin/settings/booking-rules", label: "Booking rules & IDs" },
      { href: "/admin/settings/booking-page", label: "Booking page" },
      { href: "/admin/settings/payments", label: "Payments" },
      { href: "/admin/settings/online-sessions", label: "Online sessions" },
    ],
  },
  {
    title: "Communication",
    links: [{ href: "/admin/settings/email", label: "Email & design" }],
  },
  {
    title: "Developer",
    links: [{ href: "/admin/settings/api", label: "API keys" }],
  },
];

export function SettingsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="grid gap-5 text-sm">
      {GROUPS.map((g) => (
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
