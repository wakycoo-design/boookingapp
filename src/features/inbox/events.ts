/**
 * Events that can put a notification in staff's in-app inbox (the bell), grouped as on Settings > In-app notifications.
 * Adding one: add it here, then call `inbox.notify` where it happens. It shows up on the settings page by itself.
 */
export type InboxEvent = { key: string; group: string; label: string; defaultOn: boolean };

export const INBOX_EVENTS: InboxEvent[] = [
  { key: "appointment.scheduled", group: "Appointment", label: "Scheduled", defaultOn: true },
  { key: "appointment.cancelled", group: "Appointment", label: "Cancelled", defaultOn: true },
  { key: "appointment.rescheduled", group: "Appointment", label: "Rescheduled", defaultOn: true },
  { key: "staff.created", group: "Staff", label: "Added", defaultOn: true },
  { key: "staff.edited", group: "Staff", label: "Edited", defaultOn: true },
  { key: "staff.deactivated", group: "Staff", label: "Deactivated", defaultOn: true },
  { key: "staff.on_leave", group: "Staff", label: "On leave", defaultOn: true },
  { key: "client.created", group: "Client", label: "Added", defaultOn: false },
  { key: "client.edited", group: "Client", label: "Edited", defaultOn: false },
  { key: "payment.success", group: "Payment", label: "Success", defaultOn: true },
  { key: "payment.failure", group: "Payment", label: "Failure", defaultOn: true },
];

export const DEFAULT_IN_APP_EVENTS = INBOX_EVENTS.filter((e) => e.defaultOn).map((e) => e.key);
export const isInboxEvent = (key: string) => INBOX_EVENTS.some((e) => e.key === key);
