export type BookingStatus = "upcoming" | "completed" | "cancelled" | "no_show";
export type PaymentStatus = "pending" | "paid" | "failed" | "not_required";
/** What staff may set by hand; "not_required" is decided by the service's price. */
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["pending", "paid", "failed"];
export type NoShowBy = "client" | "staff";
export type BookingSource = "web" | "staff";

export type BookingDTO = {
  id: string;
  number: number;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string | null;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  /** Online payment: when this try runs out, and the last moment the client may resume. Null for bookings paid at the desk. */
  paymentDueAt: Date | null;
  resumeUntil: Date | null;
  /** The time was given back because payment wasn't completed. */
  slotReleased: boolean;
  amountPaise: number | null;
  /** What the session cost when booked, whatever later paid for it. */
  pricePaise: number | null;
  /** Paid for with this many package credits (in thousandths: 1,500 = 1.5) and this much wallet money; both zero if given back. */
  creditMilli: number;
  creditPaise: number;
  /** From the service: where it happens. */
  meetingType: "in_person" | "google_meet";
  /** The video link clients join, made by Google or pasted by staff. */
  meetingUrl: string | null;
  meetingSource: "google" | "manual" | null;
  /** Staff override for this booking only; null follows the service. */
  meetingOverride: "on" | "off" | null;
  /** Who missed the appointment, when it was marked a no-show. */
  noShowBy: NoShowBy | null;
  source: BookingSource;
  notes: string | null;
  /** Answers to the service's extra questions, keyed by the question as it was worded at booking time. */
  formAnswers: Record<string, string>;
  cancellationReason: string | null;
  cancelledBy: string | null;
  rescheduledFromId: string | null;
  /** The newer booking this one was moved to. A moved booking is kept (status "cancelled", reason "Rescheduled") and points to its replacement here. */
  movedToId: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
};

/** What the firm's website gets back. No staff emails or internal notes. */
export type PublicBookingDTO = {
  id: string;
  reference: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  start: string;
  end: string;
  status: BookingStatus;
  rescheduledFromId: string | null;
  payment: PublicPaymentDTO;
};

/** Payment state for the website. `action` says what the client still has to do. */
export type PublicPaymentDTO = {
  status: PaymentStatus;
  amountPaise: number | null;
  /** When the current try at paying runs out (only while pending). */
  dueAt: string | null;
  /** The last moment the client can come back and finish. */
  resumeUntil: string | null;
  action: "none" | "pay" | "resume" | "choose_new_time";
  /** What was paid from the client's package or wallet, if anything. `amountPaise` is what is left to pay. */
  credit: { credits: number; walletPaise: number };
};

export function paymentAction(b: Pick<BookingDTO, "status" | "paymentStatus" | "slotReleased" | "resumeUntil">, now: Date): PublicPaymentDTO["action"] {
  if (b.status !== "upcoming") return "none";
  if (b.paymentStatus === "paid") return b.slotReleased ? "choose_new_time" : "none";
  if (b.resumeUntil === null || b.resumeUntil <= now) return "none";
  if (b.paymentStatus === "pending") return "pay";
  return b.paymentStatus === "failed" ? "resume" : "none";
}

/** "BK-" + 5-digit number, e.g. BK-00012. */
/** Prefix and number joined as they are, e.g. "WZ780" + 1007 = "WZ7801007". */
export const bookingReference = (prefix: string, n: number) => `${prefix}${n}`;

export const toPublicBooking = (b: BookingDTO, prefix: string, now: Date = new Date()): PublicBookingDTO => ({
  id: b.id,
  reference: bookingReference(prefix, b.number),
  serviceId: b.serviceId,
  serviceName: b.serviceName,
  staffId: b.staffId,
  staffName: b.staffName,
  start: b.startsAt.toISOString(),
  end: b.endsAt.toISOString(),
  status: b.status,
  rescheduledFromId: b.rescheduledFromId,
  payment: {
    status: b.paymentStatus,
    amountPaise: b.amountPaise,
    dueAt: b.paymentStatus === "pending" ? b.paymentDueAt?.toISOString() ?? null : null,
    resumeUntil: b.resumeUntil?.toISOString() ?? null,
    action: paymentAction(b, now),
    credit: { credits: b.creditMilli / 1000, walletPaise: b.creditPaise },
  },
});

export type HoldDTO = { token: string; staffId: string; start: Date; end: Date; expiresAt: Date };

/** What the bookings slice tells the rest of the app happened. */
export type BookingEvent = {
  type: "meeting_changed" | "booked" | "rescheduled" | "cancelled" | "completed" | "no_show" | "payment_success" | "payment_failed";
  bookingId: string;
  /** When it happened, so delays are counted from the same clock the booking used. */
  at: Date;
  /** For a reschedule, the booking that was replaced; its unsent messages are dropped. */
  previousBookingId?: string;
};
