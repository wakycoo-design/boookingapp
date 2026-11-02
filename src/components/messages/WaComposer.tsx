"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { startPolling } from "./chat-ui";
import type { WaReplyState } from "@/app/admin/messages/whatsapp/actions";

/** The reply box. Enter sends, Shift+Enter starts a new line; the box empties once WhatsApp has taken the message. */
export function WaComposer({ action }: { action: (prev: WaReplyState, form: FormData) => Promise<WaReplyState> }) {
  const [state, send, pending] = useActionState(action, { error: null, sentAt: null });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.sentAt) form.current?.reset();
  }, [state.sentAt]);
  return (
    <form ref={form} action={send} className="border-t border-zinc-200 p-3">
      {state.error && <p role="alert" className="mb-2 text-xs text-red-700">{state.error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          name="body"
          rows={1}
          maxLength={4096}
          required
          placeholder="Reply on WhatsApp"
          aria-label="Reply on WhatsApp"
          className="input max-h-40 min-h-10 flex-1 resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
        />
        <button className="btn" type="submit" disabled={pending}>{pending ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );
}

/** Re-reads the page every few seconds so new messages and delivery ticks appear without a reload. */
export function WaAutoRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => startPolling(() => router.refresh(), ms), [router, ms]);
  return null;
}
