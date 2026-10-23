/**
 * Every feature the Roles & permissions page controls, with what each built-in role may do by default.
 *
 * Adding a feature: add one entry here and check it where it is used (`requirePermission("x", "view")`). It appears on
 * the permissions page for every role straight away, with these defaults until an admin changes a tick. A custom role
 * follows the defaults of the built-in role it was copied from, so new features reach it too.
 */
export type BaseRole = "staff" | "manager" | "admin";
export type Action = "view" | "viewAll" | "add" | "edit" | "delete" | "export";
export const ACTIONS: Action[] = ["view", "viewAll", "add", "edit", "delete", "export"];

export type Feature = {
  key: string;
  label: string;
  group: string;
  /** What can be ticked for it. `viewAll` means "everyone's", where `view` alone means only the person's own. */
  actions: Action[];
  /** What each built-in role may do when nobody has changed it. Admins can always do everything. */
  defaults: Partial<Record<Exclude<BaseRole, "admin">, Action[]>>;
  /** Shown under the name, when the feature needs a word of explanation. */
  hint?: string;
};

const ALL: Action[] = ["view", "add", "edit", "delete"];
const SETTINGS = (key: string, label: string): Feature => ({ key: `settings.${key}`, label, group: "Settings", actions: ["view", "edit"], defaults: {} });

export const FEATURES: Feature[] = [
  {
    key: "bookings",
    label: "Bookings",
    group: "Daily work",
    actions: ["view", "viewAll", "add", "edit", "export"],
    defaults: { staff: ["view", "add", "edit"], manager: ["view", "viewAll", "add", "edit", "export"] },
    hint: "Edit covers moving, cancelling and payment status.",
  },
  { key: "calendar", label: "Calendar", group: "Daily work", actions: ["view", "viewAll"], defaults: { staff: ["view"], manager: ["view", "viewAll"] } },
  {
    key: "availability",
    label: "Availability",
    group: "Daily work",
    actions: ["view", "viewAll", "edit"],
    defaults: { staff: ["view", "edit"], manager: ["view", "viewAll", "edit"] },
    hint: "Working hours, date changes and time off.",
  },
  {
    key: "caseHistories",
    label: "Case histories",
    group: "Clinical",
    actions: ["view", "viewAll", "add", "edit"],
    defaults: { staff: ["view", "add", "edit"], manager: ["view", "viewAll", "add", "edit"] },
    hint: "Own = clients assigned to them; Everyone's = list every client. Clinical details open only for the client's therapist or a clinical admin.",
  },
  { key: "clients", label: "Clients", group: "Clients", actions: ["view", "add", "edit", "export"], defaults: { manager: ["view", "add", "edit", "export"] } },
  { key: "packages", label: "Packages & credits", group: "Clients", actions: ALL, defaults: { manager: ALL }, hint: "Includes selling packages and adding wallet money." },
  { key: "services", label: "Services", group: "Setup", actions: ALL, defaults: { manager: ALL } },
  { key: "staff", label: "Staff", group: "Setup", actions: ["view", "add", "edit"], defaults: { manager: ["view", "add", "edit"] }, hint: "Only admins can add or change admins." },
  { key: "workflows", label: "Workflows", group: "Setup", actions: ALL, defaults: { manager: ["view"] } },
  {
    key: "reports",
    label: "Reports",
    group: "Reports",
    actions: ["view", "viewAll", "export"],
    defaults: { staff: ["view"], manager: ["view", "viewAll", "export"] },
    hint: "Own = their own performance page only.",
  },
  { key: "otp", label: "OTP authentication", group: "Setup", actions: ["view", "edit"], defaults: {} },
  SETTINGS("organization", "Basic information"),
  SETTINGS("holidays", "Holidays"),
  SETTINGS("bookingRules", "Booking rules & IDs"),
  SETTINGS("bookingPage", "Booking page"),
  SETTINGS("payments", "Payments"),
  SETTINGS("onlineSessions", "Online sessions"),
  SETTINGS("email", "Email & design"),
  SETTINGS("apiKeys", "API keys"),
  SETTINGS("roles", "Roles & permissions"),
];

export const featureByKey = new Map(FEATURES.map((f) => [f.key, f]));

/** The default answer for a built-in role, before any admin changes. */
export function defaultAllows(base: BaseRole, feature: string, action: Action): boolean {
  if (base === "admin") return true;
  const f = featureByKey.get(feature);
  return Boolean(f && f.actions.includes(action) && f.defaults[base]?.includes(action));
}
