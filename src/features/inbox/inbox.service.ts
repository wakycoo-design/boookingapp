import { DomainError } from "@/features/shared/errors";
import { isUuid } from "@/features/shared/validation";
import type { BookingDTO, BookingEvent } from "@/features/bookings/bookings.dto";
import type { StaffDTO } from "@/features/staff/staff.dto";
import { permissionKey, type Permissions } from "@/features/access/access.dto";
import { dayLabel, timeLabel } from "@/lib/format";
import { DEFAULT_IN_APP_EVENTS } from "./events";
import type { InboxRepository } from "./inbox.repository";

export type Notice = {
  event: string;
  title: string;
  body?: string | null;
  href?: string | null;
  /** The staff member it is about (the booking's therapist, the person on leave): they get it with Notifications · view. */
  ownerId?: string | null;
  /** Who did it; they aren't told about their own action. */
  actorId?: string | null;
};

/**
 * The in-app inbox (the bell). An event goes to everyone allowed Notifications · everyone's, and to the person it is about
 * when they have Notifications · view, if the firm has that event switched on.
 */
export function createInboxService(deps: {
  inboxRepo: InboxRepository;
  activeStaff: () => Promise<StaffDTO[]>;
  permissionsFor: (member: StaffDTO) => Promise<Permissions>;
  enabledEvents: () => Promise<string[] | null>;
  timezone: () => Promise<string>;
  getBooking: (id: string) => Promise<BookingDTO>;
}) {
  const { inboxRepo } = deps;

  async function notify(n: Notice): Promise<number> {
    const on = (await deps.enabledEvents()) ?? DEFAULT_IN_APP_EVENTS;
    if (!on.includes(n.event)) return 0;
    const people = await deps.activeStaff();
    const to: string[] = [];
    for (const p of people) {
      if (p.id === n.actorId) continue;
      const perms = await deps.permissionsFor(p);
      const everyone = perms.has(permissionKey("notifications", "viewAll"));
      const own = p.id === n.ownerId && perms.has(permissionKey("notifications", "view"));
      if (everyone || own) to.push(p.id);
    }
    await inboxRepo.add(to.map((staffId) => ({ staffId, event: n.event, title: n.title, body: n.body ?? null, href: n.href ?? null })));
    return to.length;
  }

  const BOOKING_EVENTS: Partial<Record<BookingEvent["type"], { event: string; title: (b: BookingDTO) => string }>> = {
    booked: { event: "appointment.scheduled", title: (b) => `New appointment: ${b.clientName} with ${b.staffName}` },
    rescheduled: { event: "appointment.rescheduled", title: (b) => `Moved: ${b.clientName} with ${b.staffName}` },
    cancelled: { event: "appointment.cancelled", title: (b) => `Cancelled: ${b.clientName} with ${b.staffName}` },
    payment_success: { event: "payment.success", title: (b) => `Payment received from ${b.clientName}` },
    payment_failed: { event: "payment.failure", title: (b) => `Payment failed for ${b.clientName}` },
  };

  return {
    notify,

    /** Listener for booking changes (bookings and payments). */
    async onBookingEvent(e: BookingEvent) {
      const kind = BOOKING_EVENTS[e.type];
      if (!kind) return;
      const b = await deps.getBooking(e.bookingId);
      const tz = await deps.timezone();
      const money = b.amountPaise ? ` · ₹${(b.amountPaise / 100).toLocaleString("en-IN")}` : "";
      await notify({
        event: kind.event,
        title: kind.title(b),
        body: `${b.serviceName} · ${dayLabel(b.startsAt, tz)}, ${timeLabel(b.startsAt, tz)}${e.type.startsWith("payment") ? money : ""}`,
        href: `/admin/bookings/${b.id}`,
        ownerId: b.staffId,
      });
    },

    list: (staffId: string, limit = 50) => inboxRepo.list(staffId, limit),
    unread: (staffId: string) => inboxRepo.unread(staffId),
    readAll: (staffId: string) => inboxRepo.readAll(staffId),

    async open(staffId: string, id: string) {
      const row = isUuid(id) ? await inboxRepo.open(staffId, id) : null;
      if (!row) throw new DomainError("not_found", `Notification ${id} not found`);
      return row.href;
    },
  };
}

export type InboxService = ReturnType<typeof createInboxService>;
