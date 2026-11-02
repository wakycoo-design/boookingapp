import { UpstreamError } from "@/features/shared/errors";

/** Sends a free-text WhatsApp reply. Returns Meta's message id. */
export type WaTextSender = (to: string, body: string) => Promise<string>;

export function createWaTextSender(env: Record<string, string | undefined> = process.env): WaTextSender {
  return async (to, body) => {
    if (!env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      throw new UpstreamError("not_configured", "WhatsApp isn't set up yet. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN.");
    }
    const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body, preview_url: true } }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok || !json.messages?.[0]?.id) throw new UpstreamError("delivery_failed", `WhatsApp refused the reply: ${json.error?.message ?? `HTTP ${res.status}`}`);
    return json.messages[0].id;
  };
}
