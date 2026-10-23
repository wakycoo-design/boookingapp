import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Actor } from "@/features/audit/audit.types";
import type { BookingMode } from "@/features/availability/availability.dto";
import type { AvailabilityService } from "@/features/availability/availability.service";
import type { SettingsRepository } from "@/features/settings/settings.repository";
import { hasPrice } from "@/features/catalog/catalog.dto";
import { checkAnswers } from "@/features/catalog/questions";
import { PAYMENT_WINDOW_MIN, RESUME_WINDOW_HOURS } from "@/features/payments/payments.dto";
import { DomainError } from "@/features/shared/errors";
import { toE164 } from "@/features/shared/phone";
import { isUuid } from "@/features/shared/validation";
import { PAYMENT_STATUSES, type BookingDTO, type BookingEvent, type BookingStatus, type HoldDTO, type NoShowBy, type PaymentStatus } from "./bookings.dto";
import { isValidManageToken, manageToken } from "./manage-link";
import type { BookingsRepository, WriteResult } from "./bookings.repository";
import {
  bookingListQuery,
  cancelInput,
  createBookingInput,
  holdInput,
  idempotencyKey as idempotencyKeySchema,
  rescheduleInput,
  type BookingListQuery,
} from "./bookings.schemas";

const MIN = 60_000;
export const HOLD_MINUTES = 5;
const FAIRNESS_WINDOW_DAYS = 28;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");

/** Who is acting, for `cancelled_by` and permission rules. A website call acts for the client. */
export type BookingActor = Actor & { mode: BookingMode };

const actorLabel = (a: BookingActor) =>
  a.mode === "client" ? "client" : a.staffId ? `staff:${a.staffId}` : a.apiKeyId ? `api:${a.apiKeyId}` : "system";

function fail(result: Exclude<WriteResult<unknown>, { ok: true }>): never {
  switch (result.reason) {
    case "slot_taken":
      throw new DomainError("conflict", "That time was just booked by someone else. Pick another time.", { reason: "slot_taken" });
    case "held":
      throw new DomainError("conflict", "Someone else is booking that time right now. Pick another time.", { reason: "slot_held" });
    case "hold_missing":
      throw new DomainError("conflict", "The hold on this time expired. Pick the time again.", { reason: "hold_expired" });
    case "not_upcoming":
      throw new DomainError("conflict", "This booking is no longer upcoming", { reason: "not_upcoming" });
    case "duplicate_key":
      throw new DomainError("conflict", "This Idempotency-Key was already used", { reason: "idempotency_key_reused" });
  }
}

/**
 * Booking rules: re-check availability at write time (the slot list may be stale), let Postgres have
 * the last word on overlaps, make retries safe, and refuse cancels or moves that make no sense.
 */
export function createBookingsService(deps: {
  bookingsRepo: BookingsRepository;
  availability: AvailabilityService;
  settingsRepo: SettingsRepository;
  /** Told after a booking changes (to queue workflow messages). Optional; never allowed to fail the booking. */
  onEvent?: (event: BookingEvent) => Promise<void>;
  /** Secret for signed "manage my booking" links. Without it only the random token from booking time works. */
  manageSecret?: string;
}) {
  const { bookingsRepo, availability, settingsRepo } = deps;

  async function announce(event: BookingEvent) {
    try {
      await deps.onEvent?.(event);
    } catch (err) {
      // The booking is already saved; a lost notification is logged, not surfaced to the client.
      console.error(`Workflow event ${event.type} for booking ${event.bookingId} failed`, err);
    }
  }

  async function get(id: string): Promise<BookingDTO> {
    const row = isUuid(id) ? await bookingsRepo.findById(id) : null;
    if (!row) throw new DomainError("not_found", `Booking ${id} not found`);
    return row;
  }

  /** Fair "any available" pick: fewest recent bookings, then whoever was booked least recently. */
  async function pickStaff(staffIds: string[], now: Date): Promise<string> {
    if (staffIds.length === 1) return staffIds[0];
    const load = await bookingsRepo.recentLoad(staffIds, new Date(now.getTime() - FAIRNESS_WINDOW_DAYS * 86_400_000));
    const score = (id: string) => load.get(id) ?? { count: 0, lastStart: 0 };
    return [...staffIds].sort((a, b) => score(a).count - score(b).count || score(a).lastStart - score(b).lastStart || a.localeCompare(b))[0];
  }

  /** Who can take this time, for one person or anyone; throws when nobody can. */
  async function resolveStaff(opts: {
    serviceId: string;
    staffId?: string | null;
    start: Date;
    now: Date;
    mode: BookingMode;
    exclude?: { bookingId?: string; holdTokenHash?: string };
  }) {
    if (opts.start.getTime() <= opts.now.getTime()) throw new DomainError("invalid", "That time is in the past");
    const { service, staffIds } = await availability.freeStaffAt(opts);
    if (!staffIds.length) {
      throw new DomainError("conflict", "That time isn't available. Pick another time.", { reason: "slot_unavailable" });
    }
    return { service, staffId: await pickStaff(staffIds, opts.now) };
  }

  function checkClientCutoff(b: BookingDTO, now: Date, cutoffMin: number, what: string) {
    if (b.startsAt.getTime() - now.getTime() < cutoffMin * MIN) {
      const hours = Math.round((cutoffMin / 60) * 10) / 10;
      throw new DomainError("forbidden", `Bookings can't be ${what} online less than ${hours} hours before the start. Please contact the firm.`);
    }
  }

  return {
    get,

    async list(query: BookingListQuery) {
      const q = bookingListQuery.parse(query);
      const now = new Date();
      const views: Record<typeof q.view, { statuses?: BookingStatus[]; from?: Date; to?: Date; order: "asc" | "desc" }> = {
        upcoming: { statuses: ["upcoming"], from: now, order: "asc" },
        past: { statuses: ["upcoming", "completed", "no_show"], to: now, order: "desc" },
        cancelled: { statuses: ["cancelled"], order: "desc" },
        all: { order: "asc" },
      };
      const v = views[q.view];
      return bookingsRepo.list({
        statuses: v.statuses,
        staffId: q.staffId,
        clientId: q.clientId,
        serviceId: q.serviceId,
        paymentStatus: q.paymentStatus,
        packageBalance: q.packageBalance,
        from: q.from ?? v.from,
        to: q.to ?? v.to,
        order: v.order,
        limit: q.limit,
      });
    },

    /**
     * A client's own bookings for the website's "my bookings" page, found by phone. Each comes with its manage token so
     * the website can move or cancel it without storing anything. The website decides who is logged in.
     */
    async listForPhone(rawPhone: string, view: "upcoming" | "past" | "cancelled" | "all", now = new Date()) {
      const phone = toE164(rawPhone);
      if (!phone) throw new DomainError("invalid", "Enter a valid phone number, e.g. +91 98765 43210");
      const views: Record<typeof view, { statuses?: BookingStatus[]; from?: Date; to?: Date; order: "asc" | "desc" }> = {
        upcoming: { statuses: ["upcoming"], from: now, order: "asc" },
        past: { statuses: ["upcoming", "completed", "no_show"], to: now, order: "desc" },
        cancelled: { statuses: ["cancelled"], order: "desc" },
        all: { order: "desc" },
      };
      const q = views[view];
      const rows = await bookingsRepo.list({ phoneE164: phone, statuses: q.statuses, from: q.from, to: q.to, order: q.order, limit: 200 });
      return rows.map((b) => ({ booking: b, manageToken: deps.manageSecret ? manageToken(b.id, deps.manageSecret) : null }));
    },

    /**
     * Creates a booking. With an idempotency key, a retry of the same request returns the original
     * booking (`replayed: true`) instead of booking twice. Website bookings get a manage token, shown once.
     */
    async create(actor: BookingActor, input: unknown, opts: { idempotencyKey?: string | null; now?: Date } = {}) {
      const data = createBookingInput.parse(input);
      const now = opts.now ?? new Date();
      const key = opts.idempotencyKey ? idempotencyKeySchema.parse(opts.idempotencyKey) : null;
      if (actor.mode === "client" && !key) {
        throw new DomainError("invalid", "The Idempotency-Key header is required when creating a booking");
      }

      const replay = async () => {
        const existing = key ? await bookingsRepo.findByIdempotencyKey(key) : null;
        if (!existing) return null;
        if (existing.serviceId !== data.serviceId || existing.startsAt.getTime() !== data.start.getTime()) {
          throw new DomainError("conflict", "This Idempotency-Key was already used for a different booking", { reason: "idempotency_key_reused" });
        }
        return { booking: existing, manageToken: null, replayed: true as const };
      };
      const earlier = await replay();
      if (earlier) return earlier;

      const holdTokenHash = data.holdToken ? sha256(data.holdToken) : null;
      let staffId = data.staffId;
      if (holdTokenHash && !staffId) {
        // A hold already picked the person; book with them.
        staffId = (await bookingsRepo.findHold(holdTokenHash, now))?.staffId;
        if (!staffId) fail({ ok: false, reason: "hold_missing" });
      }
      const picked = await resolveStaff({
        serviceId: data.serviceId,
        staffId,
        start: data.start,
        now,
        mode: actor.mode,
        exclude: holdTokenHash ? { holdTokenHash } : undefined,
      });

      // Checked after the time is confirmed free, so a missing answer never hides "that time was taken".
      const answers = checkAnswers(picked.service.questions, data.formAnswers);
      // A website booking of a priced service is held until the website reports a payment (or 15 minutes pass).
      // A therapist's own price for the service wins over the service's price.
      const staffPrice = await bookingsRepo.staffPrice(picked.staffId, data.serviceId);
      const pricePaise = staffPrice ?? picked.service.pricePaise;
      const owes = staffPrice !== null ? staffPrice > 0 : hasPrice(picked.service);
      const online = actor.mode === "client" && owes && pricePaise !== null && (await settingsRepo.get()).onlinePayment;
      const payment = online
        ? {
            status: "pending" as const,
            dueAt: new Date(now.getTime() + PAYMENT_WINDOW_MIN * MIN),
            resumeUntil: new Date(now.getTime() + RESUME_WINDOW_HOURS * 60 * MIN),
            amountPaise: pricePaise,
          }
        : { status: owes ? ("pending" as const) : ("not_required" as const), dueAt: null, resumeUntil: null, amountPaise: pricePaise };
      const manageToken = actor.mode === "client" ? newToken() : null;
      const result = await bookingsRepo.create(
        {
          serviceId: data.serviceId,
          staffId: picked.staffId,
          startsAt: data.start,
          endsAt: new Date(data.start.getTime() + picked.service.durationMin * MIN),
          source: actor.mode === "client" ? "web" : "staff",
          client: { name: data.client.name, phoneE164: data.client.phone, email: data.client.email ?? null, whatsappOptIn: data.client.whatsappOptIn },
          idempotencyKey: key,
          manageTokenHash: manageToken ? sha256(manageToken) : null,
          notes: data.notes,
          formAnswers: answers,
          payment,
          pricePaise,
          credit: data.useCredits ? { owes, pricePaise } : undefined,
        },
        {
          holdTokenHash,
          now,
          audit: {
            actor,
            action: "create",
            entity: "booking",
            details: { serviceId: data.serviceId, staffId: picked.staffId, start: data.start.toISOString() },
          },
        },
      );
      if (!result.ok) {
        // Two identical retries raced: the other one won, so return what it created.
        if (result.reason === "duplicate_key") {
          const again = await replay();
          if (again) return again;
        }
        fail(result);
      }
      // An online booking is confirmed to the client once payment arrives, not before; one paid for by credit is already settled.
      if (!online || result.value.paidByCredit) await announce({ type: "booked", bookingId: result.value.id, at: now });
      return { booking: await get(result.value.id), manageToken, replayed: false as const };
    },

    /** Holds a time for a few minutes while the client fills in the website form. */
    async hold(actor: BookingActor, input: unknown, opts: { now?: Date } = {}): Promise<HoldDTO> {
      const data = holdInput.parse(input);
      const now = opts.now ?? new Date();
      const picked = await resolveStaff({ ...data, now, mode: actor.mode });
      const token = newToken();
      const end = new Date(data.start.getTime() + picked.service.durationMin * MIN);
      const expiresAt = new Date(now.getTime() + HOLD_MINUTES * MIN);
      const result = await bookingsRepo.createHold({
        staffId: picked.staffId,
        serviceId: data.serviceId,
        startsAt: data.start,
        endsAt: end,
        tokenHash: sha256(token),
        releaseAt: expiresAt,
        now,
      });
      if (!result.ok) fail(result);
      return { token, staffId: picked.staffId, start: data.start, end, expiresAt };
    },

    releaseHold: (token: string) => bookingsRepo.releaseHold(sha256(token)),

    /** The signed token for a client's manage link, or null when the app has no secret to sign with. */
    manageToken: (bookingId: string) => (deps.manageSecret ? manageToken(bookingId, deps.manageSecret) : null),

    /** The client must present a manage token: the signed one from their link, or the random one the website got when booking. */
    async verifyManageToken(bookingId: string, token: string | null | undefined) {
      if (token && deps.manageSecret && isValidManageToken(bookingId, token, deps.manageSecret)) return;
      const stored = isUuid(bookingId) ? await bookingsRepo.manageTokenHash(bookingId) : null;
      const given = token ? Buffer.from(sha256(token), "hex") : null;
      if (!stored || !given || !timingSafeEqual(Buffer.from(stored, "hex"), given)) {
        throw new DomainError("not_found", `Booking ${bookingId} not found`);
      }
    },

    /** Moves a booking: a new booking is made and the old one cancelled, together, and linked. */
    async reschedule(actor: BookingActor, id: string, input: unknown, opts: { now?: Date } = {}) {
      const data = rescheduleInput.parse(input);
      const now = opts.now ?? new Date();
      const old = await get(id);
      if (old.status !== "upcoming") throw new DomainError("conflict", `Booking ${id} is ${old.status} and can't be moved`, { reason: "not_upcoming" });
      if (old.startsAt <= now) throw new DomainError("invalid", "A booking that has already started can't be moved");
      if (actor.mode === "client" && old.resumeUntil && old.paymentStatus !== "paid") {
        throw new DomainError("conflict", "Finish payment first, or resume the booking to choose a new time", { reason: "payment_pending" });
      }
      if (actor.mode === "client") checkClientCutoff(old, now, (await settingsRepo.get()).clientCutoffMin, "moved");
      if (old.startsAt.getTime() === data.start.getTime() && (!data.staffId || data.staffId === old.staffId)) {
        throw new DomainError("invalid", "The new time is the same as the current one");
      }

      const holdTokenHash = data.holdToken ? sha256(data.holdToken) : null;
      const picked = await resolveStaff({
        serviceId: old.serviceId,
        // Keep the same person unless asked otherwise.
        staffId: data.staffId ?? old.staffId,
        start: data.start,
        now,
        mode: actor.mode,
        exclude: { bookingId: old.id, holdTokenHash: holdTokenHash ?? undefined },
      });
      const result = await bookingsRepo.reschedule(
        old.id,
        {
          serviceId: old.serviceId,
          staffId: picked.staffId,
          startsAt: data.start,
          endsAt: new Date(data.start.getTime() + picked.service.durationMin * MIN),
          notes: old.notes,
          reason: "Rescheduled",
          cancelledBy: actorLabel(actor),
        },
        {
          holdTokenHash,
          now,
          audit: {
            actor,
            action: "reschedule",
            entity: "booking",
            entityId: old.id,
            details: { from: old.startsAt.toISOString(), to: data.start.toISOString(), staffId: picked.staffId },
          },
        },
      );
      if (!result.ok) fail(result);
      await announce({ type: "rescheduled", bookingId: result.value, previousBookingId: old.id, at: now });
      return get(result.value);
    },

    async cancel(actor: BookingActor, id: string, input: unknown = {}, opts: { now?: Date } = {}) {
      const { reason } = cancelInput.parse(input ?? {});
      const now = opts.now ?? new Date();
      const b = await get(id);
      if (b.status === "cancelled") throw new DomainError("conflict", `Booking ${id} is already cancelled`, { reason: "already_cancelled" });
      if (b.status !== "upcoming") throw new DomainError("conflict", `Booking ${id} is ${b.status} and can't be cancelled`, { reason: "not_upcoming" });
      if (b.endsAt <= now) throw new DomainError("invalid", "A booking that has already ended can't be cancelled");
      if (actor.mode === "client") checkClientCutoff(b, now, (await settingsRepo.get()).clientCutoffMin, "cancelled");
      const result = await bookingsRepo.cancel(id, { reason: reason ?? null, cancelledBy: actorLabel(actor), now }, {
        actor,
        action: "cancel",
        entity: "booking",
        entityId: id,
        details: { reason: reason ?? null },
      });
      if (!result.ok) fail(result);
      await announce({ type: "cancelled", bookingId: id, at: now });
      return get(id);
    },

    /** After the start time, staff mark what happened. Undo puts it back to upcoming. */
    async markStatus(
      actor: BookingActor,
      id: string,
      status: "completed" | "no_show" | "upcoming",
      opts: { now?: Date; noShowBy?: NoShowBy } = {},
    ) {
      const now = opts.now ?? new Date();
      if (status === "no_show" && opts.noShowBy !== "client" && opts.noShowBy !== "staff") {
        throw new DomainError("invalid", "Say who missed the appointment: the client or the staff member");
      }
      const b = await get(id);
      if (status !== "upcoming" && b.startsAt > now) {
        throw new DomainError("invalid", "A booking can only be marked once it has started");
      }
      const from: BookingStatus[] = status === "upcoming" ? ["completed", "no_show"] : ["upcoming", "completed", "no_show"];
      const result = await bookingsRepo.setStatus(id, status, from, status === "no_show" ? opts.noShowBy ?? null : null, {
        actor,
        action: `mark_${status}`,
        entity: "booking",
        entityId: id,
        details: status === "no_show" ? { noShowBy: opts.noShowBy } : undefined,
      }, now);
      if (!result.ok) fail(result);
      if (status !== "upcoming") await announce({ type: status, bookingId: id, at: now });
      return get(id);
    },

    /**
     * Staff press "Use client's credit" on an unpaid booking, e.g. after the client bought a package. Spends a package
     * session or wallet money exactly as a new booking would.
     */
    async useCredit(actor: Actor, id: string, opts: { now?: Date } = {}) {
      const now = opts.now ?? new Date();
      const b = await get(id);
      if (b.status !== "upcoming") throw new DomainError("conflict", `Booking ${id} is ${b.status}; credit can only pay an upcoming booking`, { reason: "not_upcoming" });
      if (b.paymentStatus === "paid" || b.paymentStatus === "not_required") throw new DomainError("conflict", "This booking doesn't need paying", { reason: "already_paid" });
      if (b.creditMilli > 0 || b.creditPaise > 0) throw new DomainError("conflict", "Credit has already been used on this booking", { reason: "credit_used" });
      if (b.slotReleased) throw new DomainError("conflict", "The time for this booking was given back. The client needs to resume it first", { reason: "slot_released" });
      const result = await bookingsRepo.useCredit(id, { now, audit: { actor, action: "use_credit", entity: "booking", entityId: id } });
      if (!result.ok) fail(result);
      const { covered, taken, wasOnline } = result.value;
      if (taken.creditsMilli === 0 && taken.walletPaise === 0) {
        throw new DomainError("invalid", "This client has no package credit or wallet money that applies to this booking", { reason: "no_credit" });
      }
      // An online booking was never confirmed to the client; paying it off by credit is what confirms it.
      if (covered && wasOnline) await announce({ type: "booked", bookingId: id, at: now });
      return get(id);
    },

    /**
     * Staff change how one booking's online session works: add a Meet link, take it away, paste another link (Zoom or
     * anything), or go back to following the service. The calendar sync then makes or removes the Google link.
     */
    async setMeeting(actor: Actor, id: string, change: { action: "add" | "remove" | "reset" } | { action: "manual"; url: string }, opts: { now?: Date } = {}) {
      const b = await get(id);
      if (b.status === "cancelled") throw new DomainError("conflict", `Booking ${id} is cancelled`, { reason: "cancelled" });
      const audit = { actor, action: `meeting_${change.action}`, entity: "booking", entityId: id };
      if (change.action === "manual") {
        const url = change.url.trim();
        let ok = false;
        try {
          ok = /^https?:$/.test(new URL(url).protocol) && url.length <= 500;
        } catch {
          ok = false;
        }
        if (!ok) throw new DomainError("invalid", "Paste a full web address starting with https://");
        await bookingsRepo.setMeeting(id, { meetingUrl: url, meetingSource: "manual", meetingOverride: "on" }, audit);
      } else if (change.action === "add") {
        // A pasted link is replaced by a Google one; the sync fills it in within about half a minute.
        await bookingsRepo.setMeeting(id, { meetingOverride: "on", ...(b.meetingSource === "manual" ? { meetingUrl: null, meetingSource: null } : {}) }, audit);
      } else if (change.action === "remove") {
        // A Google link is cleared by the calendar sync, which also takes it off the event; a pasted link goes at once.
        await bookingsRepo.setMeeting(id, { meetingOverride: "off", ...(b.meetingSource === "google" ? {} : { meetingUrl: null, meetingSource: null }) }, audit);
      } else {
        await bookingsRepo.setMeeting(id, { meetingOverride: null, ...(b.meetingSource === "manual" ? { meetingUrl: null, meetingSource: null } : {}) }, audit);
      }
      await announce({ type: "meeting_changed", bookingId: id, at: opts.now ?? new Date() });
      return get(id);
    },

    /** A booking by its reference as people say it (e.g. "WZ7801007" with prefix "WZ780"), or null. */
    async byReference(reference: string, prefix: string): Promise<BookingDTO | null> {
      const ref = reference.trim().toUpperCase();
      const digits = ref.startsWith(prefix.toUpperCase()) ? ref.slice(prefix.length) : ref;
      return /^\d{1,12}$/.test(digits) ? bookingsRepo.findByNumber(Number(digits)) : null;
    },

    /** What the next booking's number will be; a booking attempt that fails can still use one up. */
    nextNumber: () => bookingsRepo.nextNumber(),

    /**
     * Sets the number the next booking gets (e.g. 1007); later ones count up from it. Existing bookings keep theirs.
     * It can only move forward, past every number already used, so two bookings never share one.
     */
    async setNextNumber(actor: Actor, next: number) {
      if (!Number.isInteger(next) || next < 1 || next > 2_000_000_000) {
        throw new DomainError("invalid", "The next booking number must be a whole number from 1");
      }
      const [current, latest] = await Promise.all([bookingsRepo.nextNumber(), bookingsRepo.latestNumber()]);
      if (next === current) return;
      if (next <= latest || next < current) {
        throw new DomainError("invalid", `The next booking number can only go up: it is ${current} now, so use ${Math.max(current, latest + 1)} or more`);
      }
      await bookingsRepo.restartNumbering(next, { actor, action: "update", entity: "booking_number", entityId: "next", details: { from: current, to: next } });
    },

    /** Staff record whether the client has paid. Cancelled bookings can still be marked, for refunds. */
    async setPayment(actor: Actor, id: string, status: PaymentStatus) {
      if (!PAYMENT_STATUSES.includes(status)) throw new DomainError("invalid", `Unknown payment status "${status}"`);
      await get(id);
      const audit = { actor, action: "set_payment", entity: "booking", entityId: id, details: { status } };
      // "Paid" also stops the 15-minute clock and takes the time back if it had been given up.
      if (status === "paid") await bookingsRepo.markPaid(id, audit);
      else await bookingsRepo.setPayment(id, status, audit);
      return get(id);
    },

    async updateNotes(actor: Actor, id: string, notes: string | null) {
      await get(id);
      const clean = notes?.trim().slice(0, 2000) || null;
      await bookingsRepo.updateNotes(id, clean, { actor, action: "update_notes", entity: "booking", entityId: id });
    },

    deleteExpiredHolds: (now = new Date()) => bookingsRepo.deleteExpiredHolds(now),
  };
}

export type BookingsService = ReturnType<typeof createBookingsService>;
