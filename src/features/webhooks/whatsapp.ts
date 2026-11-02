import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEventInput } from "./webhooks.dto";

/**
 * Meta signs every POST with the app secret: `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>`. It must be checked
 * against the exact bytes received, before parsing, or anyone who learns the URL could post fake events.
 */
export function validSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Payload = {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        messages?: { id?: string; type?: string }[];
        statuses?: { id?: string; status?: string; errors?: { code?: number }[] }[];
        event?: string;
        message_template_name?: string;
        reason?: string | null;
      };
    }[];
  }[];
};

/**
 * Turns one webhook delivery into events. Meta batches several changes per delivery, and one "messages" change can hold
 * both incoming messages and delivery statuses. Only types, states and Meta's ids are kept: the sender's number and the
 * message text never leave this function.
 */
export function parseWhatsAppPayload(body: unknown): WebhookEventInput[] {
  const out: WebhookEventInput[] = [];
  for (const entry of (body as Payload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (change.field === "messages") {
        for (const m of v.messages ?? []) out.push({ kind: "message", detail: m.type ?? "unknown", providerMessageId: m.id ?? null });
        for (const s of v.statuses ?? []) {
          const code = s.errors?.[0]?.code;
          out.push({ kind: "status", detail: code ? `${s.status ?? "unknown"} (error ${code})` : (s.status ?? "unknown"), providerMessageId: s.id ?? null });
        }
        if (!v.messages?.length && !v.statuses?.length) out.push({ kind: "other", detail: "messages", providerMessageId: null });
      } else if (change.field === "message_template_status_update") {
        const reason = v.reason && v.reason !== "NONE" ? `, ${v.reason}` : "";
        out.push({ kind: "template", detail: `${v.message_template_name ?? "template"}: ${v.event ?? "updated"}${reason}`, providerMessageId: null });
      } else {
        out.push({ kind: "other", detail: change.field ?? "unknown", providerMessageId: null });
      }
    }
  }
  return out;
}

export type IncomingChat = { waMessageId: string; from: string; profileName: string | null; kind: string; body: string; at: Date };
export type ChatStatus = { waMessageId: string; status: string; error: string | null };

type ChatPayload = {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; image?: { caption?: string }; video?: { caption?: string }; document?: { caption?: string; filename?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
        statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string }[] }[];
      };
    }[];
  }[];
};

/**
 * The same delivery, read for the WhatsApp inbox: who wrote what, and what happened to what we sent. Unlike
 * parseWhatsAppPayload this keeps numbers and text, so its output goes straight to the inbox and nowhere else.
 */
export function parseWhatsAppChats(body: unknown): { messages: IncomingChat[]; statuses: ChatStatus[] } {
  const messages: IncomingChat[] = [];
  const statuses: ChatStatus[] = [];
  for (const entry of (body as ChatPayload)?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const v = change.value ?? {};
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        if (!m.id || !m.from) continue;
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? m.document?.filename ?? "";
        const seconds = Number(m.timestamp);
        messages.push({ waMessageId: m.id, from: m.from, profileName: names.get(m.from) ?? null, kind: m.type ?? "unknown", body: text, at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date() });
      }
      for (const s of v.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const e = s.errors?.[0];
        statuses.push({ waMessageId: s.id, status: s.status, error: e ? `${e.title ?? "Error"} (${e.code ?? "?"})` : null });
      }
    }
  }
  return { messages, statuses };
}
