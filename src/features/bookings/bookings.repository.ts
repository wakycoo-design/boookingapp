import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { booking, client, notification, service, slotHold, staff, staffService } from "@/db/schema";
import { writeAudit } from "@/features/audit/audit.repository";
import type { AuditEntry } from "@/features/audit/audit.types";
import type { ClientContact } from "@/features/clients/clients.dto";
import { upsertClient } from "@/features/clients/clients.repository";
import type { Allocation } from "@/features/packages/packages.dto";
import { applyCredits, moveCredits, returnCredits } from "@/features/packages/packages.repository";
import { PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, pgError } from "@/features/shared/db-errors";
import type { BookingDTO, BookingSource, BookingStatus, NoShowBy, PaymentStatus } from "./bookings.dto";

const columns = {
  id: booking.id,
  number: booking.number,
  serviceId: booking.serviceId,
  serviceName: service.name,
  staffId: booking.staffId,
  staffName: staff.name,
  clientId: booking.clientId,
  clientName: client.name,
  clientPhone: client.phoneE164,
  clientEmail: client.email,
  startsAt: booking.startsAt,
  endsAt: booking.endsAt,
  status: booking.status,
  paymentStatus: booking.paymentStatus,
  paymentDueAt: booking.paymentDueAt,
  resumeUntil: booking.resumeUntil,
  slotReleased: booking.slotReleased,
  amountPaise: booking.amountPaise,
  pricePaise: booking.pricePaise,
  creditMilli: booking.creditMilli,
  creditPaise: booking.creditPaise,
  meetingType: service.meetingType,
  meetingUrl: booking.meetingUrl,
  meetingSource: sql<"google" | "manual" | null>`${booking.meetingSource}`,
  meetingOverride: sql<"on" | "off" | null>`${booking.meetingOverride}`,
  noShowBy: booking.noShowBy,
  source: booking.source,
  notes: booking.notes,
  formAnswers: booking.formAnswers,
  cancellationReason: booking.cancellationReason,
  cancelledBy: booking.cancelledBy,
  rescheduledFromId: booking.rescheduledFromId,
  movedToId: sql<string | null>`(select n.id from booking n where n.rescheduled_from_id = ${booking.id} limit 1)`,
  idempotencyKey: booking.idempotencyKey,
  createdAt: booking.createdAt,
};

export type NewBooking = {
  serviceId: string;
  staffId: string;
  startsAt: Date;
  endsAt: Date;
  source: BookingSource;
  client: ClientContact | { id: string };
  idempotencyKey?: string | null;
  manageTokenHash?: string | null;
  notes?: string | null;
  formAnswers?: Record<string, string>;
  /** Set when the booking is paid online: how long the client has to pay, and to come back. */
  payment?: { status: PaymentStatus; dueAt: Date | null; resumeUntil: Date | null; amountPaise: number | null };
  /** What the session costs (that therapist's price), kept for the booking list and reports. */
  pricePaise?: number | null;
  /** Spend the client's package session or wallet money on this booking, if they have any that applies. */
  credit?: { owes: boolean; pricePaise: number | null };
};

/** What creating a booking ended up as, after any credit was applied. */
export type CreatedBooking = { id: string; paidByCredit: boolean };

/** Why a write was refused by the database's own guards. */
export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "slot_taken" | "held" | "hold_missing" | "duplicate_key" | "not_upcoming" };

/**
 * Serialises writes per staff member for the rest of the transaction. The exclusion constraint already
 * stops overlapping bookings; the lock also covers holds and buffers, which the constraint can't see.
 * Locks are taken in a fixed order so two transactions never wait on each other.
 */
async function lockStaff(tx: Tx, staffIds: string[]) {
  for (const id of [...new Set(staffIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
  }
}

/** Uses up the caller's hold (it must match the staff member and times) and checks nobody else holds the time. */
async function claimTime(tx: Tx, t: { staffId: string; startsAt: Date; endsAt: Date; holdTokenHash?: string | null; now: Date }) {
  if (t.holdTokenHash) {
    const used = await tx
      .delete(slotHold)
      .where(
        and(
          eq(slotHold.tokenHash, t.holdTokenHash),
          eq(slotHold.staffId, t.staffId),
          eq(slotHold.startsAt, t.startsAt),
          gt(slotHold.releaseAt, t.now),
        ),
      )
      .returning({ id: slotHold.id });
    if (!used.length) return "hold_missing" as const;
  }
  const [other] = await tx
    .select({ id: slotHold.id })
    .from(slotHold)
    .where(
      and(
        eq(slotHold.staffId, t.staffId),
        gt(slotHold.releaseAt, t.now),
        lt(slotHold.startsAt, t.endsAt),
        gt(slotHold.endsAt, t.startsAt),
      ),
    )
    .limit(1);
  return other ? ("held" as const) : null;
}

async function insertBooking(tx: Tx, b: NewBooking, extra: { rescheduledFromId?: string; paymentStatus?: PaymentStatus; amountPaise?: number | null; pricePaise?: number | null } = {}) {
  const clientId = "id" in b.client ? b.client.id : await upsertClient(tx, b.client);
  const [row] = await tx
    .insert(booking)
    .values({
      serviceId: b.serviceId,
      staffId: b.staffId,
      clientId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      source: b.source,
      idempotencyKey: b.idempotencyKey ?? null,
      manageTokenHash: b.manageTokenHash ?? null,
      notes: b.notes ?? null,
      formAnswers: b.formAnswers ?? {},
      paymentStatus: b.payment?.status ?? extra.paymentStatus ?? "pending",
      paymentDueAt: b.payment?.dueAt ?? null,
      resumeUntil: b.payment?.resumeUntil ?? null,
      amountPaise: b.payment?.amountPaise ?? extra.amountPaise ?? null,
      pricePaise: b.pricePaise ?? extra.pricePaise ?? null,
      rescheduledFromId: extra.rescheduledFromId ?? null,
    })
    .returning({ id: booking.id });
  return row.id;
}

/**
 * Spends the client's credit on a booking that already exists in this transaction, and settles its payment:
 * fully covered means paid with no clock; partly covered leaves the remainder to pay.
 */
async function settleWithCredit(tx: Tx, bookingId: string, serviceId: string, credit: { owes: boolean; pricePaise: number | null }, now: Date) {
  const [row] = await tx.select({ clientId: booking.clientId }).from(booking).where(eq(booking.id, bookingId));
  const used = await applyCredits(tx, { bookingId, clientId: row.clientId, serviceId, ...credit, now });
  const covered = used.covered;
  if (covered) {
    // Nothing left to pay: the payment clock never starts.
    await tx.update(booking).set({ paymentStatus: "paid", paymentDueAt: null, resumeUntil: null, amountPaise: null }).where(eq(booking.id, bookingId));
  } else if ((used.creditsMilli > 0 || used.walletPaise > 0) && used.duePaise !== null) {
    // Credit paid part of it; what is left is paid in the normal way.
    await tx.update(booking).set({ amountPaise: used.duePaise }).where(eq(booking.id, bookingId));
  }
  return { used, covered };
}

/** Maps the database's refusals to a reason; anything else is a real error and is rethrown. */
function refusal(err: unknown): WriteResult<never> {
  const { code, constraint } = pgError(err);
  if (code === PG_EXCLUSION_VIOLATION) return { ok: false, reason: "slot_taken" };
  if (code === PG_UNIQUE_VIOLATION && constraint?.includes("idempotency")) return { ok: false, reason: "duplicate_key" };
  throw err;
}

class Refused extends Error {
  constructor(public readonly reason: Exclude<WriteResult<never>, { ok: true }>["reason"]) {
    super(reason);
  }
}

export function createBookingsRepository(db: Db) {
  const base = () =>
    db
      .select(columns)
      .from(booking)
      .innerJoin(service, eq(service.id, booking.serviceId))
      .innerJoin(staff, eq(staff.id, booking.staffId))
      .innerJoin(client, eq(client.id, booking.clientId));

  async function findById(id: string): Promise<BookingDTO | null> {
    const [row] = await base().where(eq(booking.id, id));
    return row ?? null;
  }

  /** Runs `fn` in a transaction and turns guard failures into a WriteResult instead of an exception. */
  async function guarded<T>(fn: (tx: Tx) => Promise<T>): Promise<WriteResult<T>> {
    try {
      return { ok: true, value: await db.transaction(fn) };
    } catch (err) {
      if (err instanceof Refused) return { ok: false, reason: err.reason };
      return refusal(err);
    }
  }

  return {
    findById,

    async findByIdempotencyKey(key: string): Promise<BookingDTO | null> {
      const [row] = await base().where(eq(booking.idempotencyKey, key));
      return row ?? null;
    },

    /** The price this person charges for the service, when it differs from the service's own. */
    async staffPrice(staffId: string, serviceId: string): Promise<number | null> {
      const [row] = await db
        .select({ p: staffService.pricePaise })
        .from(staffService)
        .where(and(eq(staffService.staffId, staffId), eq(staffService.serviceId, serviceId)));
      return row?.p ?? null;
    },

    async manageTokenHash(id: string): Promise<string | null> {
      const [row] = await db.select({ h: booking.manageTokenHash }).from(booking).where(eq(booking.id, id));
      return row?.h ?? null;
    },

    list(q: {
      statuses?: BookingStatus[];
      staffId?: string | null;
      clientId?: string | null;
      serviceId?: string | null;
      paymentStatus?: PaymentStatus | null;
      packageBalance?: "has" | "none" | null;
      phoneE164?: string | null;
      from?: Date | null;
      to?: Date | null;
      order?: "asc" | "desc";
      limit: number;
    }): Promise<BookingDTO[]> {
      const where: (SQL | undefined)[] = [
        q.statuses?.length ? inArray(booking.status, q.statuses) : undefined,
        q.staffId ? eq(booking.staffId, q.staffId) : undefined,
        q.clientId ? eq(booking.clientId, q.clientId) : undefined,
        q.serviceId ? eq(booking.serviceId, q.serviceId) : undefined,
        q.paymentStatus ? eq(booking.paymentStatus, q.paymentStatus) : undefined,
        // Package sessions the client can still use: some credit left on a package that has not run out.
        q.packageBalance
          ? sql`${q.packageBalance === "has" ? sql`exists` : sql`not exists`} (select 1 from client_package cp where cp.client_id = ${booking.clientId} and cp.credits_left_milli > 0 and (cp.expires_at is null or cp.expires_at > now()))`
          : undefined,
        q.phoneE164 ? eq(client.phoneE164, q.phoneE164) : undefined,
        q.from ? gte(booking.endsAt, q.from) : undefined,
        q.to ? lte(booking.startsAt, q.to) : undefined,
      ];
      return base()
        .where(and(...where))
        .orderBy(q.order === "desc" ? desc(booking.startsAt) : asc(booking.startsAt))
        .limit(q.limit);
    },

    /** Live bookings per staff member since `since`, and when each was last booked, for a fair pick. */
    async recentLoad(staffIds: string[], since: Date): Promise<Map<string, { count: number; lastStart: number }>> {
      const rows = staffIds.length
        ? await db
            .select({
              staffId: booking.staffId,
              count: sql<number>`count(*)::int`,
              last: sql<string | null>`max(${booking.startsAt})::text`,
            })
            .from(booking)
            .where(and(inArray(booking.staffId, staffIds), ne(booking.status, "cancelled"), eq(booking.slotReleased, false), gte(booking.startsAt, since)))
            .groupBy(booking.staffId)
        : [];
      return new Map(rows.map((r) => [r.staffId, { count: r.count, lastStart: r.last ? Date.parse(r.last) : 0 }]));
    },

    async create(b: NewBooking, opts: { holdTokenHash?: string | null; now: Date; audit: Omit<AuditEntry, "entityId"> }) {
      return guarded(async (tx) => {
        await lockStaff(tx, [b.staffId]);
        const blocked = await claimTime(tx, { ...b, holdTokenHash: opts.holdTokenHash, now: opts.now });
        if (blocked) throw new Refused(blocked);
        const id = await insertBooking(tx, b);
        let paidByCredit = false;
        if (b.credit) paidByCredit = (await settleWithCredit(tx, id, b.serviceId, b.credit, opts.now)).covered;
        await writeAudit(tx, { ...opts.audit, entityId: id });
        return { id, paidByCredit } satisfies CreatedBooking;
      });
    },

    /**
     * Cancels the old booking and inserts the new one in one transaction. The old row is cancelled first,
     * so the overlap constraint doesn't see the booking clash with itself when it moves by a few minutes.
     */
    async reschedule(
      oldId: string,
      next: Omit<NewBooking, "client" | "source"> & { reason: string; cancelledBy: string },
      opts: { holdTokenHash?: string | null; now: Date; audit: AuditEntry },
    ) {
      return guarded(async (tx) => {
        const [old] = await tx
          .select({
            staffId: booking.staffId,
            clientId: booking.clientId,
            source: booking.source,
            manageTokenHash: booking.manageTokenHash,
            formAnswers: booking.formAnswers,
            paymentStatus: booking.paymentStatus,
            amountPaise: booking.amountPaise,
            pricePaise: booking.pricePaise,
          })
          .from(booking)
          .where(eq(booking.id, oldId));
        if (!old) throw new Refused("not_upcoming");
        await lockStaff(tx, [old.staffId, next.staffId]);
        const cancelled = await tx
          .update(booking)
          .set({ status: "cancelled", cancellationReason: next.reason, cancelledBy: next.cancelledBy })
          .where(and(eq(booking.id, oldId), eq(booking.status, "upcoming")))
          .returning({ id: booking.id });
        if (!cancelled.length) throw new Refused("not_upcoming");
        await tx.delete(notification).where(and(eq(notification.bookingId, oldId), eq(notification.status, "queued")));
        const blocked = await claimTime(tx, { ...next, holdTokenHash: opts.holdTokenHash, now: opts.now });
        if (blocked) throw new Refused(blocked);
        const id = await insertBooking(
          tx,
          // The client keeps the same manage link for the moved booking.
          // The client's answers and what they have paid belong to the visit, not to the time slot, so they move too.
          { ...next, client: { id: old.clientId }, source: old.source, manageTokenHash: old.manageTokenHash, formAnswers: old.formAnswers },
          { rescheduledFromId: oldId, paymentStatus: old.paymentStatus, amountPaise: old.amountPaise, pricePaise: old.pricePaise },
        );
        await moveCredits(tx, oldId, id);
        await writeAudit(tx, { ...opts.audit, details: { ...opts.audit.details, newBookingId: id } });
        return id;
      });
    },

    /** Only an upcoming booking can be cancelled; the status check in the UPDATE makes a double cancel a no-op. */
    async cancel(id: string, data: { reason: string | null; cancelledBy: string; now: Date }, audit: AuditEntry) {
      return guarded(async (tx) => {
        const rows = await tx
          .update(booking)
          .set({ status: "cancelled", cancellationReason: data.reason, cancelledBy: data.cancelledBy })
          .where(and(eq(booking.id, id), eq(booking.status, "upcoming")))
          .returning({ id: booking.id });
        if (!rows.length) throw new Refused("not_upcoming");
        // Reminders for a cancelled booking must never go out.
        await tx.delete(notification).where(and(eq(notification.bookingId, id), eq(notification.status, "queued")));
        // A cancelled booking gives back whatever it was paid with.
        const back = await returnCredits(tx, id, data.now);
        await writeAudit(tx, { ...audit, details: { ...audit.details, creditReturned: back } });
        return id;
      });
    },

    async setStatus(
      id: string,
      status: "completed" | "no_show" | "upcoming",
      from: BookingStatus[],
      noShowBy: NoShowBy | null,
      audit: AuditEntry,
      now: Date = new Date(),
    ) {
      return guarded(async (tx) => {
        const rows = await tx
          .update(booking)
          // The database only allows "no_show_by" on a no-show, so every other status clears it.
          .set({ status, noShowBy: status === "no_show" ? noShowBy : null })
          .where(and(eq(booking.id, id), inArray(booking.status, from)))
          .returning({ id: booking.id });
        if (!rows.length) throw new Refused("not_upcoming");
        // The client missing it keeps the credit used; if the staff member missed it, the client gets it back.
        const back = status === "no_show" && noShowBy === "staff" ? await returnCredits(tx, id, now) : null;
        await writeAudit(tx, back ? { ...audit, details: { ...audit.details, creditReturned: back } } : audit);
        return id;
      });
    },

    /**
     * Online bookings whose 15 minutes ran out: the payment fails and the time goes back on offer.
     * Done in one statement so two workers can't both claim the same booking.
     */
    async expirePending(now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(booking)
          .set({ paymentStatus: "failed", slotReleased: true })
          .where(and(eq(booking.status, "upcoming"), eq(booking.paymentStatus, "pending"), lte(booking.paymentDueAt, now)))
          .returning({ id: booking.id });
        for (const r of rows) await writeAudit(tx, { actor: {}, action: "payment_expired", entity: "booking", entityId: r.id });
        return rows.map((r) => r.id);
      });
    },

    /** Unpaid online bookings the client didn't come back to within 24 hours are cancelled. Paid ones are never touched. */
    async cancelUnpaid(now: Date): Promise<string[]> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(booking)
          .set({ status: "cancelled", cancellationReason: "Payment was not completed within 24 hours", cancelledBy: "system", slotReleased: true })
          .where(and(eq(booking.status, "upcoming"), inArray(booking.paymentStatus, ["pending", "failed"]), lte(booking.resumeUntil, now)))
          .returning({ id: booking.id });
        for (const r of rows) {
          // Wallet money or a session held for a booking nobody paid the rest of goes back to the client.
          await returnCredits(tx, r.id, now);
          await writeAudit(tx, { actor: {}, action: "payment_timeout_cancel", entity: "booking", entityId: r.id });
        }
        return rows.map((r) => r.id);
      });
    },

    /**
     * Records a payment. If the time had been given back, it is taken again when nobody else has it;
     * otherwise the booking stays paid with its time released, and the client is asked to choose a new one.
     */
    async markPaid(id: string, audit: AuditEntry): Promise<{ result: "cancelled" | "already" | "paid"; slotReleased: boolean }> {
      return db.transaction(async (tx) => {
        const [b] = await tx
          .select({ status: booking.status, paymentStatus: booking.paymentStatus, slotReleased: booking.slotReleased, staffId: booking.staffId })
          .from(booking)
          .where(eq(booking.id, id))
          .for("update");
        if (!b || b.status === "cancelled") return { result: "cancelled" as const, slotReleased: true };
        if (b.paymentStatus === "paid") return { result: "already" as const, slotReleased: b.slotReleased };
        await lockStaff(tx, [b.staffId]);
        let slotReleased = b.slotReleased;
        if (slotReleased) {
          try {
            // A savepoint: if someone took the time meanwhile, only this step is undone.
            await tx.transaction((sp) => sp.update(booking).set({ slotReleased: false }).where(eq(booking.id, id)));
            slotReleased = false;
          } catch (err) {
            if (pgError(err).code !== PG_EXCLUSION_VIOLATION) throw err;
          }
        }
        await tx.update(booking).set({ paymentStatus: "paid", paymentDueAt: null }).where(eq(booking.id, id));
        await writeAudit(tx, { ...audit, details: { ...audit.details, timeKept: !slotReleased } });
        return { result: "paid" as const, slotReleased };
      });
    },

    /**
     * Takes a time for a booking whose time was given back, at the same time or a new one. With `pay`, the
     * booking goes back to "payment pending" for another 15 minutes.
     */
    async reclaim(
      id: string,
      t: { staffId: string; startsAt: Date; endsAt: Date; pay: { dueAt: Date } | null },
      opts: { now: Date; audit: AuditEntry },
    ) {
      return guarded(async (tx) => {
        const [b] = await tx.select({ staffId: booking.staffId, status: booking.status }).from(booking).where(eq(booking.id, id)).for("update");
        if (!b || b.status !== "upcoming") throw new Refused("not_upcoming");
        await lockStaff(tx, [b.staffId, t.staffId]);
        const blocked = await claimTime(tx, { staffId: t.staffId, startsAt: t.startsAt, endsAt: t.endsAt, now: opts.now });
        if (blocked) throw new Refused(blocked);
        await tx
          .update(booking)
          .set({
            staffId: t.staffId,
            startsAt: t.startsAt,
            endsAt: t.endsAt,
            slotReleased: false,
            ...(t.pay ? { paymentStatus: "pending" as const, paymentDueAt: t.pay.dueAt } : {}),
          })
          .where(eq(booking.id, id));
        await writeAudit(tx, opts.audit);
        return id;
      });
    },

    /**
     * Pays an existing, unpaid booking with the client's credit (for a package or wallet money added after the
     * booking was made). Refused unless the booking is upcoming, unpaid, still holds its time, and has used no credit yet.
     */
    async useCredit(
      id: string,
      opts: { now: Date; audit: AuditEntry },
    ): Promise<WriteResult<{ covered: boolean; taken: Allocation; wasOnline: boolean }>> {
      return guarded(async (tx) => {
        const [b] = await tx
          .select({
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            slotReleased: booking.slotReleased,
            serviceId: booking.serviceId,
            staffId: booking.staffId,
            amountPaise: booking.amountPaise,
            resumeUntil: booking.resumeUntil,
            creditMilli: booking.creditMilli,
            creditPaise: booking.creditPaise,
          })
          .from(booking)
          .where(eq(booking.id, id))
          .for("update");
        if (!b || b.status !== "upcoming" || b.slotReleased || !["pending", "failed"].includes(b.paymentStatus) || b.creditMilli > 0 || b.creditPaise > 0) {
          throw new Refused("not_upcoming");
        }
        const { used, covered } = await settleWithCredit(tx, id, b.serviceId, { owes: true, pricePaise: b.amountPaise }, opts.now);
        await writeAudit(tx, { ...opts.audit, details: { ...opts.audit.details, taken: used, covered } });
        return { covered, taken: used, wasOnline: b.resumeUntil !== null };
      });
    },

    /** A client's bookings that still need something from them: pay, resume, or choose a new time. */
    listResumable(phoneE164: string, now: Date): Promise<BookingDTO[]> {
      return base()
        .where(
          and(
            eq(client.phoneE164, phoneE164),
            eq(booking.status, "upcoming"),
            or(
              and(inArray(booking.paymentStatus, ["pending", "failed"]), gt(booking.resumeUntil, now)),
              and(eq(booking.paymentStatus, "paid"), eq(booking.slotReleased, true)),
            ),
          ),
        )
        .orderBy(asc(booking.startsAt));
    },

    /** Staff change how this booking's meeting works. `undefined` leaves a field as it is. */
    async setMeeting(
      id: string,
      patch: { meetingUrl?: string | null; meetingSource?: "google" | "manual" | null; meetingOverride?: "on" | "off" | null },
      audit: AuditEntry,
    ) {
      await db.transaction(async (tx) => {
        await tx.update(booking).set(patch).where(eq(booking.id, id));
        await writeAudit(tx, audit);
      });
    },

    /** Highest booking number so far, to show the admin what the next ID will look like. */
    /** The number the next booking will get, read from the booking number counter itself. */
    async nextNumber(): Promise<number> {
      const res = await db.execute(sql`select last_value::int as "last", is_called as "called" from booking_number_seq`);
      const row = res.rows[0] as { last: number; called: boolean } | undefined;
      return row ? (row.called ? row.last + 1 : row.last) : 1;
    },

    /** Makes the next booking take this number; later ones count up from it. Only ever forward, so no number repeats. */
    async restartNumbering(next: number, audit: AuditEntry): Promise<void> {
      if (!Number.isSafeInteger(next) || next < 1) throw new Error("Booking number must be a positive whole number");
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`alter table booking alter column number restart with ${next}`));
        await writeAudit(tx, audit);
      });
    },

    async latestNumber(): Promise<number> {
      const [row] = await db.select({ n: sql<number>`coalesce(max(${booking.number}), 0)::int` }).from(booking);
      return row.n;
    },

    async setPayment(id: string, status: PaymentStatus, audit: AuditEntry) {
      await db.transaction(async (tx) => {
        await tx.update(booking).set({ paymentStatus: status }).where(eq(booking.id, id));
        await writeAudit(tx, audit);
      });
    },

    async updateNotes(id: string, notes: string | null, audit: AuditEntry) {
      await db.transaction(async (tx) => {
        await tx.update(booking).set({ notes }).where(eq(booking.id, id));
        await writeAudit(tx, audit);
      });
    },

    /** A short hold on a time while the client finishes the website form. */
    async createHold(h: { staffId: string; serviceId: string; startsAt: Date; endsAt: Date; tokenHash: string; releaseAt: Date; now: Date }) {
      return guarded(async (tx) => {
        await lockStaff(tx, [h.staffId]);
        const blocked = await claimTime(tx, { ...h, holdTokenHash: null });
        if (blocked) throw new Refused(blocked);
        const [clash] = await tx
          .select({ id: booking.id })
          .from(booking)
          .where(and(eq(booking.staffId, h.staffId), ne(booking.status, "cancelled"), lt(booking.startsAt, h.endsAt), gt(booking.endsAt, h.startsAt)))
          .limit(1);
        if (clash) throw new Refused("slot_taken");
        await tx.insert(slotHold).values({
          staffId: h.staffId,
          serviceId: h.serviceId,
          startsAt: h.startsAt,
          endsAt: h.endsAt,
          tokenHash: h.tokenHash,
          releaseAt: h.releaseAt,
        });
        return h.tokenHash;
      });
    },

    async findHold(tokenHash: string, now: Date) {
      const [row] = await db
        .select({ staffId: slotHold.staffId, serviceId: slotHold.serviceId, startsAt: slotHold.startsAt })
        .from(slotHold)
        .where(and(eq(slotHold.tokenHash, tokenHash), gt(slotHold.releaseAt, now)));
      return row ?? null;
    },

    async releaseHold(tokenHash: string) {
      await db.delete(slotHold).where(eq(slotHold.tokenHash, tokenHash));
    },

    /** Cleanup for expired holds; queries already ignore them, this just keeps the table small. */
    async deleteExpiredHolds(now: Date): Promise<number> {
      const rows = await db.delete(slotHold).where(lte(slotHold.releaseAt, now)).returning({ id: slotHold.id });
      return rows.length;
    },
  };
}

export type BookingsRepository = ReturnType<typeof createBookingsRepository>;

