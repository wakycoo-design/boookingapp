/** The settings sub-modules, grouped like an admin centre. */
export const SETTINGS_GROUPS: { title: string; links: { href: string; label: string; feature: string }[] }[] = [
  {
    title: "Organization",
    links: [
      { href: "/admin/settings/organization", label: "Basic information", feature: "settings.organization" },
      { href: "/admin/settings/holidays", label: "Holidays", feature: "settings.holidays" },
    ],
  },
  {
    title: "Bookings",
    links: [
      { href: "/admin/settings/booking-rules", label: "Booking rules & IDs", feature: "settings.bookingRules" },
      { href: "/admin/settings/booking-page", label: "Booking page", feature: "settings.bookingPage" },
      { href: "/admin/settings/payments", label: "Payments", feature: "settings.payments" },
      { href: "/admin/settings/online-sessions", label: "Online sessions", feature: "settings.onlineSessions" },
    ],
  },
  {
    title: "Users & access",
    links: [{ href: "/admin/settings/roles", label: "Roles & permissions", feature: "settings.roles" }],
  },
  {
    title: "Communication",
    links: [
      { href: "/admin/settings/email", label: "Email & design", feature: "settings.email" },
      { href: "/admin/settings/notifications", label: "In-app notifications", feature: "settings.notifications" },
    ],
  },
  {
    title: "Developer",
    links: [{ href: "/admin/settings/api", label: "API keys", feature: "settings.apiKeys" }],
  },
];
