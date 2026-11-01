"use client";

import { useEffect, useRef, useState } from "react";

/** Below this the app feels broken (pages and saves take seconds); above the upper mark we call it fine again. */
const SLOW_BELOW_MBPS = 1;
const FINE_ABOVE_MBPS = 1.5;
/** Only downloads big enough to measure speed rather than latency count towards the estimate. */
const MIN_SAMPLE_BYTES = 20_000;
const PING_TIMEOUT_MS = 5_000;

type NetworkInformation = EventTarget & { downlink?: number; effectiveType?: string };

/**
 * Tells people when their connection drops or crawls, so a save that never arrives isn't a mystery.
 * Offline is decided by the browser's online/offline events and confirmed by pinging /api/ping, because `navigator.onLine`
 * only knows about the local network: wifi with no internet still says "online". A failed request also triggers a check,
 * which is how an interruption mid-session is caught.
 */
export function ConnectionStatus() {
  const [offline, setOffline] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const [mbps, setMbps] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const offlineRef = useRef(false);
  const checkRef = useRef<() => void>(() => {});

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let backTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 2_000;
    let inFlight = false;
    const realFetch = window.fetch.bind(window);

    const goOffline = () => {
      if (offlineRef.current) return;
      offlineRef.current = true;
      setOffline(true);
      setBackOnline(false);
      retryDelay = 2_000;
      scheduleRetry();
    };
    const goOnline = () => {
      clearTimeout(retryTimer);
      if (!offlineRef.current) return;
      offlineRef.current = false;
      setOffline(false);
      setBackOnline(true);
      clearTimeout(backTimer);
      backTimer = setTimeout(() => setBackOnline(false), 3_000);
    };

    async function check() {
      if (inFlight) return;
      inFlight = true;
      setChecking(true);
      try {
        const res = await realFetch(`/api/ping?t=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
        if (res.ok) goOnline();
        else goOffline();
      } catch {
        goOffline();
      } finally {
        inFlight = false;
        setChecking(false);
        if (offlineRef.current) scheduleRetry();
      }
    }
    checkRef.current = () => void check();

    // Back off to 30s so a long outage doesn't keep the radio busy.
    function scheduleRetry() {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void check(), retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    }

    const onOffline = () => goOffline();
    const onOnline = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible" && offlineRef.current) void check();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    if (!navigator.onLine) goOffline();

    // A request that fails at the network level (not an HTTP error, not one we cancelled) is the first sign of an interruption.
    window.fetch = async (...args) => {
      try {
        return await realFetch(...args);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) void check();
        throw err;
      }
    };

    // Speed: Chrome and Android report it directly; elsewhere we time the page's own downloads, which costs no extra data.
    const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
    const samples: number[] = [];
    const update = (value: number) => {
      setMbps(value);
      setSlow((was) => (was ? value < FINE_ABOVE_MBPS : value < SLOW_BELOW_MBPS));
    };
    const fromConnection = () => {
      if (!connection) return;
      if (connection.effectiveType === "slow-2g" || connection.effectiveType === "2g") update(Math.min(connection.downlink ?? 0.1, 0.25));
      else if (typeof connection.downlink === "number" && connection.downlink > 0) update(connection.downlink);
    };
    let observer: PerformanceObserver | undefined;
    if (connection && typeof connection.downlink === "number") {
      fromConnection();
      connection.addEventListener("change", fromConnection);
    } else if (typeof PerformanceObserver !== "undefined") {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          const seconds = (entry.responseEnd - entry.responseStart) / 1000;
          if (entry.transferSize < MIN_SAMPLE_BYTES || seconds <= 0) continue;
          samples.push((entry.transferSize * 8) / seconds / 1_000_000);
          if (samples.length > 5) samples.shift();
          // The median of the last few, so one stalled image doesn't flip the banner.
          const sorted = [...samples].sort((a, b) => a - b);
          update(sorted[Math.floor(sorted.length / 2)]);
        }
      });
      try {
        observer.observe({ type: "resource", buffered: true });
      } catch {
        observer = undefined;
      }
    }

    return () => {
      clearTimeout(retryTimer);
      clearTimeout(backTimer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.fetch = realFetch;
      connection?.removeEventListener("change", fromConnection);
      observer?.disconnect();
    };
  }, []);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4" aria-live="assertive">
        {offline && (
          <div role="alert" className="conn-tab pointer-events-auto flex max-w-full items-center gap-3 rounded-b-xl border border-t-0 border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800 shadow-sm">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <b className="font-medium">You&apos;re offline.</b>{" "}
              <span className="text-red-700">Changes won&apos;t save until the connection is back.</span>
            </span>
            <button type="button" onClick={() => checkRef.current()} disabled={checking} className="shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-60">
              {checking ? "Checking…" : "Retry"}
            </button>
          </div>
        )}
        {!offline && backOnline && (
          <div role="status" className="conn-tab pointer-events-auto flex items-center gap-2 rounded-b-xl border border-t-0 border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-800 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden="true" /> Back online
          </div>
        )}
      </div>

      {!offline && slow && !dismissed && mbps !== null && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" aria-live="polite">
          <div role="status" className="conn-pill pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-zinc-300 bg-white py-1.5 pl-3 pr-1.5 text-sm text-black shadow-md">
            <SignalBars mbps={mbps} />
            <span className="min-w-0">
              <b className="font-medium">Slow connection</b>
              <span className="text-zinc-600"> · {mbps < 0.1 ? "under 0.1" : mbps.toFixed(1)} Mbps. Pages may take longer to load.</span>
            </span>
            <button type="button" onClick={() => setDismissed(true)} className="icon-btn h-7 w-7 shrink-0 rounded-full" aria-label="Dismiss">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function WifiOff({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M12 20h.01" />
    </svg>
  );
}

/** Four bars, lit by how bad it is: one bar under 0.25 Mbps, two under 0.5, three below 1. */
function SignalBars({ mbps }: { mbps: number }) {
  const lit = mbps < 0.25 ? 1 : mbps < 0.5 ? 2 : 3;
  return (
    <span className="flex h-4 shrink-0 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`w-[3px] rounded-sm ${i < lit ? "bg-black" : "bg-zinc-300"}`} style={{ height: `${(i + 1) * 25}%` }} />
      ))}
    </span>
  );
}
