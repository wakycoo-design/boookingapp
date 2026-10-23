"use server";

import { app } from "@/features/container";
import type { PaymentStatus } from "@/features/bookings/bookings.dto";
import type { BookingActor } from "@/features/bookings/bookings.service";
import { act, answersFromForm, optional, str } from "@/lib/form-actions";
import { requirePermission } from "@/lib/session";

const deskActor = (staffId: string): BookingActor => ({ staffId, mode: "staff" });

export async function createBookingAction(form: FormData) {
  const me = await requirePermission("bookings", "add");
  const back = `/admin/bookings/new?${new URLSearchParams({
    service: str(form, "serviceId"),
    staff: str(form, "staffId"),
    date: str(form, "date"),
    start: str(form, "start"),
  })}`;
  await act(back, "Booked", async () => {
    const { booking } = await app().bookings.create(deskActor(me.id), {
      serviceId: str(form, "serviceId"),
      staffId: optional(form, "staffId"),
      start: str(form, "start"),
      client: {
        name: str(form, "clientName"),
        phone: str(form, "clientPhone"),
        email: optional(form, "clientEmail"),
        whatsappOptIn: form.get("whatsappOptIn") === "on",
      },
      notes: optional(form, "notes"),
      formAnswers: answersFromForm(form),
    });
    return `/admin/bookings/${booking.id}`;
  });
}

export async function rescheduleBookingAction(id: string, start: string, staffId: string) {
  const me = await requirePermission("bookings", "edit");
  await act(`/admin/bookings/${id}`, "Booking moved", async () => {
    const moved = await app().bookings.reschedule(deskActor(me.id), id, { start, staffId });
    return `/admin/bookings/${moved.id}`;
  });
}

export async function cancelBookingAction(id: string, form: FormData) {
  const me = await requirePermission("bookings", "edit");
  await act(`/admin/bookings/${id}`, "Booking cancelled", () =>
    app().bookings.cancel(deskActor(me.id), id, { reason: optional(form, "reason") }),
  );
}

export async function markBookingAction(id: string, status: "completed" | "no_show" | "upcoming", form: FormData) {
  const me = await requirePermission("bookings", "edit");
  const by = str(form, "by");
  await act(`/admin/bookings/${id}`, "Status updated", () =>
    app().bookings.markStatus(deskActor(me.id), id, status, { noShowBy: by === "client" || by === "staff" ? by : undefined }),
  );
}

export async function setPaymentAction(id: string, status: PaymentStatus) {
  const me = await requirePermission("bookings", "edit");
  await act(`/admin/bookings/${id}`, "Payment updated", () => app().bookings.setPayment({ staffId: me.id }, id, status));
}

export async function useCreditAction(id: string) {
  const me = await requirePermission("bookings", "edit");
  await act(`/admin/bookings/${id}`, "Paid with the client's credit", () => app().bookings.useCredit({ staffId: me.id }, id));
}

export async function meetingAction(id: string, action: "add" | "remove" | "reset") {
  const me = await requirePermission("bookings", "edit");
  const done = { add: "Meet link requested", remove: "Online link removed", reset: "Back to the service's setting" } as const;
  await act(`/admin/bookings/${id}`, done[action], () => app().bookings.setMeeting({ staffId: me.id }, id, { action }));
}

export async function manualMeetingAction(id: string, form: FormData) {
  const me = await requirePermission("bookings", "edit");
  await act(`/admin/bookings/${id}`, "Link saved", () => app().bookings.setMeeting({ staffId: me.id }, id, { action: "manual", url: str(form, "url") }));
}

export async function updateBookingNotesAction(id: string, form: FormData) {
  const me = await requirePermission("bookings", "edit");
  await act(`/admin/bookings/${id}`, "Notes saved", () => app().bookings.updateNotes({ staffId: me.id }, id, optional(form, "notes")));
}

/** Staff type in a payment (cash, a transfer, or one the website couldn't report). Amount is entered in rupees. */
export async function recordPaymentAction(id: string, form: FormData) {
  const me = await requirePermission("bookings", "edit");
  await act(`/admin/bookings/${id}`, "Payment recorded", () =>
    app().payments.recordManual({ staffId: me.id }, id, {
      amountPaise: Math.round(Number(str(form, "amount").replace(/,/g, "")) * 100),
      method: optional(form, "method"),
      razorpayPaymentId: optional(form, "razorpayPaymentId"),
      razorpayOrderId: optional(form, "razorpayOrderId"),
      notes: optional(form, "notes"),
      status: "paid",
    }),
  );
}
