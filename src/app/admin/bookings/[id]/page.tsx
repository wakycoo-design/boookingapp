import Link from "next/link";
import { notFound } from "next/navigation";
import { app } from "@/features/container";
import { bookingReference } from "@/features/bookings/bookings.dto";
import { addDays } from "@/features/availability/slots";
import { isDomainError } from "@/features/shared/errors";
import { isOnlineSession } from "@/features/bookings/meeting";
import { requirePermission } from "@/lib/session";
import { zonedToUtc } from "@/lib/time";
import { isoDay, longDayLabel, NO_SHOW_BY_LABEL, PAYMENT_LABEL, timeLabel } from "@/lib/format";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/Shell";
import { PaymentBadge, StatusBadge } from "@/components/StatusBadge";
import { cancelBookingAction, markBookingAction, recordPaymentAction, manualMeetingAction, meetingAction, rescheduleBookingAction, setPaymentAction, updateBookingNotesAction, useCreditAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string; move?: string; date?: string }>;
}) {
  await requirePermission("bookings", "view");
  const { id } = await params;
  const sp = await searchParams;
  const { bookings, availability, settings, staff } = app();
  const b = await bookings.get(id).catch((err) => {
    if (isDomainError(err)) notFound();
    throw err;
  });
  const s = await settings.get();
  const [paymentRows, creditUses, credit, calendar] = await Promise.all([app().payments.forBooking(b.id), app().packages.usesForBooking(b.id), app().packages.summary(b.clientId), app().calendar.status(b.staffId)]);
  const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const tz = s.timezone;
  const now = new Date();
  const started = b.startsAt <= now;
  const canMove = b.status === "upcoming" && !started;
  const moving = canMove && sp.move === "1";
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : isoDay(b.startsAt, tz);

  const [people, slots] = moving
    ? await Promise.all([
        staff.listBookableForService(b.serviceId),
        availability
          .slots(
            { serviceId: b.serviceId, staffId: b.staffId, from: zonedToUtc(`${date}T00:00`, tz), to: zonedToUtc(`${addDays(date, 1)}T00:00`, tz) },
            { mode: "staff", exclude: { bookingId: b.id } },
          )
          .then((r) => r.slots)
          .catch(() => []),
      ])
    : [[], []];
  const moveHref = (d: string) => `/admin/bookings/${b.id}?move=1&date=${d}`;

  return (
    <>
      <PageHeader
        title={`${b.serviceName} with ${b.clientName}`}
        subtitle={`${bookingReference(s.bookingPrefix, b.number)} · booked ${b.source === "web" ? "online" : "by staff"}`}
        action={<span className="flex flex-wrap gap-1.5"><PaymentBadge status={b.paymentStatus} /><StatusBadge status={b.status} /></span>}
      />
      <Notice error={sp.error} ok={sp.ok} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section className="card divide-y divide-zinc-100">
          <dl className="grid gap-5 p-6 sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wider text-zinc-600">When</dt><dd className="mt-1">{longDayLabel(b.startsAt, tz)}<br />{timeLabel(b.startsAt, tz)} – {timeLabel(b.endsAt, tz)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-zinc-600">With</dt><dd className="mt-1"><Link className="hover:underline" href={`/admin/staff/${b.staffId}`}>{b.staffName}</Link></dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Client</dt><dd className="mt-1"><Link className="hover:underline" href={`/admin/clients/${b.clientId}`}>{b.clientName}</Link><br /><span className="text-zinc-600">{b.clientPhone}</span></dd></div>
            <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Service</dt><dd className="mt-1">{b.serviceName}</dd></div>
            {b.status === "no_show" && (
              <div className="sm:col-span-2"><dt className="text-xs font-medium uppercase tracking-wider text-red-700">No-show by</dt><dd className="mt-1 text-red-700">{b.noShowBy ? NO_SHOW_BY_LABEL[b.noShowBy] : "Not recorded"}</dd></div>
            )}
            {b.status === "cancelled" && (
              <div className="sm:col-span-2"><dt className="text-xs font-medium uppercase tracking-wider text-red-700">Cancelled</dt><dd className="mt-1 text-red-700">{b.cancellationReason ?? "No reason given"}{b.cancelledBy === "client" && " (by the client)"}</dd></div>
            )}
            {Object.entries(b.formAnswers).map(([question, answer]) => (
              <div key={question} className="sm:col-span-2"><dt className="text-xs uppercase tracking-wider text-zinc-600">{question}</dt><dd className="mt-1 whitespace-pre-wrap">{answer}</dd></div>
            ))}
            {b.rescheduledFromId && (
              <div className="sm:col-span-2 text-sm text-zinc-600">Moved from <Link className="underline" href={`/admin/bookings/${b.rescheduledFromId}`}>an earlier booking</Link>.</div>
            )}
          </dl>
          <div className="grid gap-3 p-6">
            <h2 className="font-medium">Online session</h2>
            {(() => {
              const online = isOnlineSession(b, s.meetEnabled);
              const conn = calendar.connection;
              const live = b.status === "upcoming";
              if (b.meetingUrl) {
                return (
                  <div className="grid gap-3 text-sm">
                    <p className="flex flex-wrap items-center gap-3">
                      <a className="btn-join" href={b.meetingUrl} target="_blank" rel="noreferrer">Join now</a>
                      <span className="min-w-0 break-all text-zinc-600">{b.meetingUrl}</span>
                      <span className="badge">{b.meetingSource === "manual" ? "Pasted link" : "Google Meet"}</span>
                    </p>
                    {live && (
                      <div className="flex flex-wrap gap-2">
                        {b.meetingSource === "manual" && s.meetEnabled && <form action={meetingAction.bind(null, b.id, "add")}><button className="btn-ghost" type="submit">Use Google Meet instead</button></form>}
                        <form action={meetingAction.bind(null, b.id, "remove")}><button className="btn-ghost" type="submit">Remove link</button></form>
                      </div>
                    )}
                  </div>
                );
              }
              if (online) {
                const blocked = !conn ? "The therapist has not connected Google Calendar, so Google can't make a link." : !conn.createMeetLinks ? "The therapist has switched off Meet links in their Google Calendar settings." : !conn.pushBookings ? "The therapist's calendar isn't receiving bookings (turned off in their settings)." : conn.errorCount >= 5 ? `Google Calendar sync has stopped: ${conn.lastError ?? "reconnect needed"}.` : null;
                return (
                  <div className="grid gap-3 text-sm">
                    <p className={blocked ? "font-medium text-red-700" : "text-zinc-600"}>{blocked ?? "The link is being prepared and appears here within about a minute."}</p>
                    {live && (
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={manualMeetingAction.bind(null, b.id)} className="flex flex-wrap gap-2">
                          <input className="input w-64" name="url" placeholder="Or paste a link (Zoom, Meet …)" aria-label="Meeting link" />
                          <button className="btn-ghost" type="submit">Save link</button>
                        </form>
                        <form action={meetingAction.bind(null, b.id, "remove")}><button className="btn-ghost" type="submit">Make it in person</button></form>
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div className="grid gap-3 text-sm">
                  <p className="text-zinc-600">In person.{!s.meetEnabled && " Online sessions are switched off in Settings."}</p>
                  {live && s.meetEnabled && (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={meetingAction.bind(null, b.id, "add")}><button className="btn-ghost" type="submit">Make it online (Google Meet)</button></form>
                      <form action={manualMeetingAction.bind(null, b.id)} className="flex flex-wrap gap-2">
                        <input className="input w-64" name="url" placeholder="Or paste a link" aria-label="Meeting link" />
                        <button className="btn-ghost" type="submit">Save link</button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="grid gap-3 p-6">
            <h2 className="font-medium">Payment</h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Amount due</dt><dd className="mt-1">{b.amountPaise !== null ? rupees(b.amountPaise) : "Not set"}</dd></div>
              {b.paymentStatus === "pending" && b.paymentDueAt && (
                <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Pay by</dt><dd className="mt-1">{timeLabel(b.paymentDueAt, tz)}, {longDayLabel(b.paymentDueAt, tz)}</dd></div>
              )}
              {b.resumeUntil && b.paymentStatus !== "paid" && (
                <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Client can resume until</dt><dd className="mt-1">{timeLabel(b.resumeUntil, tz)}, {longDayLabel(b.resumeUntil, tz)}</dd></div>
              )}
            </dl>
            {b.status === "upcoming" && !b.slotReleased && (b.paymentStatus === "pending" || b.paymentStatus === "failed") && b.creditMilli === 0 && b.creditPaise === 0 && (credit.packages.length > 0 || credit.walletPaise > 0) && (
              <form action={useCreditAction.bind(null, b.id)} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 p-3 text-sm">
                <span className="flex-1">
                  This client has {Number(credit.packages.reduce((n, p) => n + p.creditsLeft, 0).toFixed(3))} package credits ({rupees(credit.packageValuePaise)}) and {rupees(credit.walletPaise)} in wallet money.
                </span>
                <button className="btn-ghost" type="submit">Pay with their credit</button>
              </form>
            )}
            {creditUses.length > 0 && (
              <div className="rounded-lg border border-zinc-200 p-3 text-sm">
                <p className="mb-1 font-medium">Paid with credit</p>
                {creditUses.map((u) => (
                  <p key={u.id} className="flex flex-wrap gap-x-3">
                    <span>{u.kind === "package" ? `${Number(u.credits.toFixed(3))} credit${u.credits === 1 ? "" : "s"} of ${u.label} (${rupees(u.valuePaise)}), covering ${rupees(u.coveredPaise)}` : `${rupees(u.amountPaise)} from wallet`}</span>
                    <span className={u.returnedAt ? "font-medium text-green-700" : "text-zinc-600"}>{u.returnedAt ? "Given back to the client" : "Used"}</span>
                  </p>
                ))}
                {b.paymentStatus !== "paid" && b.amountPaise !== null && <p className="mt-1 text-zinc-600">Still to pay: {rupees(b.amountPaise)}</p>}
              </div>
            )}
            {b.slotReleased && (
              <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {b.paymentStatus === "paid" ? "Paid, but this time was given to someone else. The client needs to choose a new time." : "Payment didn’t arrive in time, so this time is free for others. The client can still resume within 24 hours."}
              </p>
            )}
            {paymentRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>When</th><th>Result</th><th>Amount</th><th>Razorpay IDs</th><th>Method</th></tr></thead>
                  <tbody>
                    {paymentRows.map((p) => (
                      <tr key={p.id} className="align-top">
                        <td className="whitespace-nowrap text-zinc-600">{longDayLabel(p.paidAt, tz)}<br />{timeLabel(p.paidAt, tz)}</td>
                        <td>
                          <span className={`badge ${p.status === "paid" ? "border-green-600/40 text-green-700" : "border-red-600/40 text-red-700"}`}>{p.status === "paid" ? "Paid" : p.status === "failed" ? "Failed" : "Refunded"}</span>
                          {p.needsRefund && <p className="mt-1 text-xs font-medium text-red-700">Refund this in Razorpay</p>}
                          {p.errorDescription && <p className="mt-1 max-w-48 text-xs text-red-700">{p.errorDescription}</p>}
                        </td>
                        <td>{rupees(p.amountPaise)}</td>
                        <td className="font-mono text-xs text-zinc-600">{p.razorpayPaymentId ?? "–"}<br />{p.razorpayOrderId ?? ""}</td>
                        <td className="text-zinc-600">{p.method ?? "–"}{p.source === "staff" && " · entered by staff"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-zinc-600">No payment recorded yet.</p>
            )}
            {b.paymentStatus !== "paid" && b.status !== "cancelled" && (
              <form action={recordPaymentAction.bind(null, b.id)} className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2">
                <p className="text-sm font-medium sm:col-span-2">Record a payment</p>
                <div><label className="label" htmlFor="amount">Amount (₹)</label><input className="input" id="amount" name="amount" inputMode="decimal" defaultValue={b.amountPaise !== null ? String(b.amountPaise / 100) : ""} required /></div>
                <div><label className="label" htmlFor="method">Method</label><input className="input" id="method" name="method" placeholder="UPI, cash, card…" /></div>
                <div><label className="label" htmlFor="razorpayPaymentId">Razorpay payment ID</label><input className="input font-mono" id="razorpayPaymentId" name="razorpayPaymentId" placeholder="pay_…" /></div>
                <div><label className="label" htmlFor="razorpayOrderId">Razorpay order ID</label><input className="input font-mono" id="razorpayOrderId" name="razorpayOrderId" placeholder="order_…" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="payNotes">Note</label><input className="input" id="payNotes" name="notes" /></div>
                <div className="sm:col-span-2"><button className="btn" type="submit">Mark as paid</button></div>
              </form>
            )}
          </div>
          <form action={updateBookingNotesAction.bind(null, b.id)} className="grid gap-3 p-6">
            <label className="label" htmlFor="notes">Staff notes</label>
            <textarea className="input" id="notes" name="notes" rows={3} defaultValue={b.notes ?? ""} />
            <div><button className="btn-ghost" type="submit">Save notes</button></div>
          </form>
        </section>

        <aside className="grid content-start gap-4">
          {canMove && !moving && <Link className="btn justify-center" href={moveHref(date)}>Reschedule</Link>}
          {started && b.status !== "cancelled" && (
            <div className="card grid gap-2 p-4">
              <p className="mb-1 text-sm text-zinc-600">What happened?</p>
              <form action={markBookingAction.bind(null, b.id, "completed")}><button className="btn-ghost w-full justify-center" type="submit" disabled={b.status === "completed"}>Completed</button></form>
              <form action={markBookingAction.bind(null, b.id, "no_show")} className="grid gap-2">
                <p className="mt-1 text-xs text-zinc-600">No-show: who missed it?</p>
                {(["client", "staff"] as const).map((who) => (
                  <button key={who} className="btn-ghost w-full justify-center" type="submit" name="by" value={who} disabled={b.status === "no_show" && b.noShowBy === who}>
                    {NO_SHOW_BY_LABEL[who]} didn&apos;t show
                  </button>
                ))}
              </form>
              {b.status !== "upcoming" && <form action={markBookingAction.bind(null, b.id, "upcoming")}><button className="w-full text-xs text-zinc-600 hover:underline" type="submit">Undo</button></form>}
            </div>
          )}
          {b.paymentStatus !== "paid" && b.paymentStatus !== "not_required" && (
            <div className="card grid gap-2 p-4">
              <p className="mb-1 text-sm text-zinc-600">Payment label</p>
              {(["pending", "failed"] as const).map((p) => (
                <form key={p} action={setPaymentAction.bind(null, b.id, p)}>
                  <button className="btn-ghost w-full justify-center" type="submit" disabled={b.paymentStatus === p}>{PAYMENT_LABEL[p]}</button>
                </form>
              ))}
            </div>
          )}
          {b.status === "upcoming" && b.endsAt > now && (
            <form action={cancelBookingAction.bind(null, b.id)} className="card grid gap-3 p-4">
              <label className="label" htmlFor="reason">Cancel this booking</label>
              <input className="input" id="reason" name="reason" placeholder="Reason (optional)" />
              <button className="btn-danger justify-center" type="submit">Cancel booking</button>
            </form>
          )}
        </aside>
      </div>

      {moving && (
        <section className="card mt-6 p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <Link className="icon-btn" href={moveHref(addDays(date, -1))} aria-label="Previous day">‹</Link>
            <h2 className="text-center font-medium">Move to {longDayLabel(new Date(`${date}T12:00:00Z`), "UTC")}</h2>
            <Link className="icon-btn" href={moveHref(addDays(date, 1))} aria-label="Next day">›</Link>
          </div>
          <p className="mb-4 text-sm text-zinc-600">Free times for {b.staffName}. The old time is released when you pick a new one.</p>
          {slots.length === 0 && <p className="text-sm text-zinc-600">No free times this day.</p>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {slots.map((x) =>
              x.start.getTime() === b.startsAt.getTime() ? (
                <span key="current" className="rounded-md border border-dashed border-zinc-300 px-2 py-2 text-center text-sm text-zinc-600">
                  {timeLabel(x.start, tz)} (now)
                </span>
              ) : (
                <form key={x.start.toISOString()} action={rescheduleBookingAction.bind(null, b.id, x.start.toISOString(), b.staffId)}>
                  <button className="w-full rounded-md border border-zinc-200 px-2 py-2 text-sm hover:border-zinc-500" type="submit">{timeLabel(x.start, tz)}</button>
                </form>
              ),
            )}
          </div>
          {people.length > 1 && <p className="mt-4 text-xs text-zinc-600">To move it to someone else, cancel and book again.</p>}
          <Link className="mt-4 inline-block text-sm text-zinc-600 hover:underline" href={`/admin/bookings/${b.id}`}>Close</Link>
        </section>
      )}
    </>
  );
}
