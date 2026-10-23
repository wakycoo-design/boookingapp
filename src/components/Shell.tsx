import { signOut } from "@/auth";
import { app } from "@/features/container";
import { FEATURES } from "@/features/access/features";
import type { StaffDTO } from "@/features/staff/staff.dto";
import { can, currentPermissions } from "@/lib/session";
import { Icon } from "./icons";
import { NavLink } from "./NavLink";
import { SidebarFrame } from "./SidebarFrame";

/** App frame: a black sidebar on the left (cal.com style) and the page on the right. */
export async function Shell({ me, children }: { me: StaffDTO; children: React.ReactNode }) {
  // Each menu item shows only for those allowed to view it (Settings, Roles & permissions).
  const [perms, role, unread] = await Promise.all([currentPermissions(), app().access.roleOf(me), app().inbox.unread(me.id)]);
  const sees = (feature: string) => can(perms, feature, "view");
  const manages = ["services", "staff", "packages", "clients", "reports", "workflows"].some(sees);
  const settings = FEATURES.some((f) => f.key.startsWith("settings.") && sees(f.key));
  return (
    <SidebarFrame
      sidebar={
        <>
            <div className="flex items-center gap-2 px-3 pb-2 pt-1 md:pb-6">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-black text-sm font-bold text-white">W</span>
              <span className="font-semibold tracking-tight text-black">Waky Booking</span>
            </div>
            <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Main">
              <NavLink href="/" icon="home" exact>Today</NavLink>
              {sees("notifications") && (
                <NavLink href="/admin/notifications" icon="bell">
                  Notifications
                  {unread > 0 && <span className="ml-auto rounded-full bg-green-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{unread > 99 ? "99+" : unread}</span>}
                </NavLink>
              )}
              {sees("bookings") && <NavLink href="/admin/bookings" icon="list">Bookings</NavLink>}
              {sees("calendar") && <NavLink href="/admin/calendar" icon="calendar">Calendar</NavLink>}
              {sees("availability") && <NavLink href={`/admin/staff/${me.id}`} icon="clock">Availability</NavLink>}
              {(manages || sees("caseHistories")) && <p className="nav-heading">Manage</p>}
              {sees("services") && <NavLink href="/admin/services" icon="grid">Services</NavLink>}
              {sees("staff") && <NavLink href="/admin/staff" icon="users" exact>Staff</NavLink>}
              {sees("packages") && <NavLink href="/admin/packages" icon="wallet">Packages</NavLink>}
              {sees("clients") && <NavLink href="/admin/clients" icon="user">Clients</NavLink>}
              {sees("caseHistories") && <NavLink href="/admin/case-histories" icon="file">Case histories</NavLink>}
              {can(perms, "reports", "viewAll") && <NavLink href="/admin/reports" icon="chart">Reports</NavLink>}
              {sees("workflows") && <NavLink href="/admin/workflows" icon="bolt">Workflows</NavLink>}
              {sees("otp") && <NavLink href="/admin/otp" icon="shield">OTP Authentication</NavLink>}
              {settings && <NavLink href="/admin/settings" icon="settings">Settings</NavLink>}
            </nav>
            {/* Closed by default: Sign out only appears after clicking the profile. Plain <details>, no script needed. */}
            <details className="group relative mt-auto hidden border-t border-zinc-200 pt-4 md:block">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 hover:bg-zinc-200 [&::-webkit-details-marker]:hidden">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-medium text-black group-open:bg-white">
                  {me.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-black">{me.name}</span>
                  <span className="block truncate text-xs text-zinc-600">{role?.name ?? me.role}</span>
                </span>
                <span className="text-zinc-500 transition-transform group-open:rotate-180" aria-hidden="true">⌃</span>
              </summary>
              <form
                className="absolute inset-x-0 bottom-full mb-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg"
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button className="nav-link w-full" type="submit"><Icon name="logout" /> Sign out</button>
              </form>
            </details>
        </>
      }
    >
      {children}
    </SidebarFrame>
  );
}

/** Page title row with an optional action on the right. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
