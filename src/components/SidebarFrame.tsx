"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const KEY = "waky.sidebar";
const DEFAULT_W = 240;
const MIN_W = 180;
const MAX_W = 420;

const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));

/**
 * Desktop sidebar the user can drag to resize or hide entirely (Ctrl/Cmd+B), so pages can use the full window.
 * The sidebar and page arrive as props so they stay server components. Settings has its own menu, so there the sidebar
 * starts hidden and the page uses the full window; » shows it for that visit, and leaving Settings brings back the usual one.
 */
export function SidebarFrame({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_W);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const loaded = useRef(false);
  const inSettings = usePathname().startsWith("/admin/settings");
  const [peek, setPeek] = useState(false);
  // Entering or leaving Settings starts it hidden again (adjusting state during render, not in an effect).
  const [wasInSettings, setWasInSettings] = useState(inSettings);
  if (wasInSettings !== inSettings) {
    setWasInSettings(inSettings);
    setPeek(false);
  }
  const hidden = inSettings ? !peek : collapsed;
  const setHidden = useCallback((h: boolean | ((h: boolean) => boolean)) => {
    if (inSettings) setPeek((p) => !(typeof h === "function" ? h(!p) : h));
    else setCollapsed(h);
  }, [inSettings]);

  // Read after mount: localStorage does not exist during server render.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { w?: number; c?: boolean } | null;
      /* eslint-disable react-hooks/set-state-in-effect -- must hydrate from localStorage after mount to match the server HTML */
      if (saved?.w) setWidth(clamp(saved.w));
      if (saved?.c) setCollapsed(true);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Private mode or corrupt value: keep the defaults.
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ w: width, c: collapsed }));
    } catch {
      // Not persisting is fine.
    }
  }, [width, collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setHidden((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setHidden]);

  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);
  const onDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragging) setWidth(clamp(e.clientX));
    },
    [dragging],
  );
  const stopDrag = useCallback(() => setDragging(false), []);

  // --sidebar-w is the space the page reserves (0 when hidden); --sidebar-open-w is the sidebar's own width, which must stay
  // non-zero so sliding it off-screen by 100% actually clears it.
  const style = {
    "--sidebar-w": hidden ? "0px" : `${width}px`,
    "--sidebar-open-w": `${width}px`,
  } as React.CSSProperties;

  return (
    <div
      className={`group/shell min-h-screen md:pl-[var(--sidebar-w)] ${dragging ? "select-none" : "md:transition-[padding]"}`}
      style={style}
      data-collapsed={hidden}
    >
      <aside className={`sidebar ${hidden ? "md:-translate-x-full md:invisible" : ""} ${dragging ? "" : "md:transition-transform"}`}>
        {sidebar}
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="absolute right-2 top-5 hidden rounded-md p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-black md:block"
          aria-label="Hide sidebar"
          title="Hide sidebar (Ctrl/Cmd+B)"
        >
          «
        </button>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize, double-click to reset"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onDoubleClick={() => setWidth(DEFAULT_W)}
          className={`absolute inset-y-0 -right-1 hidden w-2 cursor-col-resize md:block hover:bg-zinc-300 ${dragging ? "bg-zinc-400" : ""}`}
        />
      </aside>
      {hidden && (
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="fixed left-3 top-3 z-20 hidden rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-600 shadow-sm hover:bg-zinc-100 hover:text-black md:block"
          aria-label="Show sidebar"
          title="Show sidebar (Ctrl/Cmd+B)"
        >
          »
        </button>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6 group-data-[collapsed=true]/shell:max-w-none md:px-10 md:py-10">
        {children}
      </main>
    </div>
  );
}
