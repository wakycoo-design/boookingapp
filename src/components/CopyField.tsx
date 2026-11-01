"use client";

import { useState } from "react";

/** A read-only value with a Copy button, for things admins paste into another service (URLs, tokens). */
export function CopyField({ id, value, hidden = false }: { id: string; value: string; hidden?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!hidden);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (an old browser or an insecure page): select the text so Ctrl+C still works.
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  }
  return (
    <div className="flex gap-2">
      <input className="input font-mono" id={id} readOnly type={shown ? "text" : "password"} value={value} onFocus={(e) => e.currentTarget.select()} />
      {hidden && <button className="btn-ghost" type="button" onClick={() => setShown((s) => !s)}>{shown ? "Hide" : "Show"}</button>}
      <button className="btn-ghost" type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
