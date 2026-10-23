"use client";

import { useState } from "react";
import { bookingReference } from "@/features/bookings/bookings.dto";

/** The booking ID's prefix and next number with a live example, so the admin sees exactly what clients will be given. */
export function BookingPrefixField({ initial, nextNumber }: { initial: string; nextNumber: number }) {
  const [prefix, setPrefix] = useState(initial);
  const [next, setNext] = useState(String(nextNumber));
  const shown = /^\d+$/.test(next) ? Number(next) : nextNumber;
  return (
    <>
      <div>
        <label className="label" htmlFor="bookingPrefix">Booking ID prefix</label>
        <input
          className="input"
          id="bookingPrefix"
          name="bookingPrefix"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          maxLength={10}
          pattern="[A-Za-z0-9_\-]*"
          placeholder="BK-"
        />
      </div>
      <div>
        <label className="label" htmlFor="nextNumber">Next booking number</label>
        <input className="input" id="nextNumber" name="nextNumber" type="number" min={nextNumber} step={1} value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <p className="-mt-2 text-xs text-zinc-600 sm:col-span-2">
        Next booking will be <strong className="text-black">{bookingReference(prefix, shown)}</strong>, then {bookingReference(prefix, shown + 1)} and so on.
        The number can only go up. Changing the prefix renames every booking, old ones included; old bookings keep their numbers.
      </p>
    </>
  );
}
