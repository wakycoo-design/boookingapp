import { app } from "@/features/container";
import type { WebhookKind } from "@/features/webhooks/webhooks.dto";
import { requirePermission } from "@/lib/session";
import { CopyField } from "@/components/CopyField";
import { PageHeader } from "@/components/Shell";

export const dynamic = "force-dynamic";

/** The webhook fields to tick in Meta, and what each one brings in. */
const FIELDS: { kind: WebhookKind; field: string; title: string; what: string }[] = [
  { kind: "message", field: "messages", title: "Receive messages", what: "A client writes or replies to your WhatsApp number." },
  { kind: "status", field: "messages", title: "Delivery status", what: "A message we sent was sent, delivered, read or failed. Arrives on the same messages field." },
  { kind: "template", field: "message_template_status_update", title: "Template reviews", what: "Meta approved, rejected or paused one of your message templates." },
];

const KIND_LABEL: Record<WebhookKind, string> = { message: "Message received", status: "Delivery status", template: "Template review", other: "Other" };

export default async function WebhooksSettingsPage() {
  await requirePermission("settings.webhooks", "view");
  const { webhooks, settings } = app();
  const [events, firm] = await Promise.all([webhooks.recent(50), settings.get()]);
  const status = webhooks.status();
  const base = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
  const callbackUrl = `${base || "https://your-app"}/api/webhooks/whatsapp`;
  const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: firm.timezone, dateStyle: "medium", timeStyle: "short" });
  const last = (kind: WebhookKind) => events.find((e) => e.kind === kind);
  const ready = status.verifyTokenSet && status.appSecretSet;

  return (
    <>
      <PageHeader title="Webhooks" subtitle="Let Meta tell the app when clients message your WhatsApp number, when messages are delivered and when templates are reviewed." />
      <div className="grid max-w-3xl gap-6">
        <section className="card grid gap-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">WhatsApp (Meta)</h2>
            <span className={`badge ${ready ? "border-green-300 text-green-700" : "border-red-300 bg-red-50 text-red-700"}`}>{ready ? "Ready to connect" : "Setup needed"}</span>
          </div>
          <div>
            <label className="label" htmlFor="callback-url">Callback URL</label>
            <CopyField id="callback-url" value={callbackUrl} />
            {!base && <p className="mt-1.5 text-xs text-red-700">AUTH_URL isn&apos;t set, so the app can&apos;t tell its own web address. Set it to the app&apos;s public HTTPS address.</p>}
          </div>
          <div>
            <label className="label" htmlFor="verify-token">Verify token</label>
            {status.verifyToken ? (
              <CopyField id="verify-token" value={status.verifyToken} hidden />
            ) : (
              <p className="text-sm text-red-700">Not set. Add WHATSAPP_WEBHOOK_VERIFY_TOKEN to the app&apos;s environment variables (any long random word), then restart.</p>
            )}
          </div>
          <div className="text-sm">
            <span className="label">App secret</span>
            {status.appSecretSet ? (
              <p className="text-zinc-600">Set. Every event Meta sends is checked against it, so nobody else can post fake events.</p>
            ) : (
              <p className="text-red-700">Not set. Add WHATSAPP_APP_SECRET (Meta app dashboard, App settings, Basic, App secret). Until then events from Meta are refused.</p>
            )}
          </div>
          <ol className="grid list-decimal gap-1 pl-5 text-sm text-zinc-600">
            <li>In the Meta app dashboard open WhatsApp, Configuration, and press Edit under Webhook.</li>
            <li>Paste the callback URL and verify token above, then press Verify and save.</li>
            <li>Under Webhook fields, subscribe to <b className="font-medium text-black">messages</b> and <b className="font-medium text-black">message_template_status_update</b>.</li>
          </ol>
        </section>

        <section className="card p-6">
          <h2 className="mb-4 font-semibold">Events</h2>
          <ul className="divide-y divide-zinc-200">
            {FIELDS.map((f) => {
              const e = last(f.kind);
              return (
                <li key={f.kind} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">{f.title} <code className="ml-1 text-xs font-normal text-zinc-500">{f.field}</code></span>
                    <span className="block text-zinc-600">{f.what}</span>
                  </span>
                  <span className={`badge ${e ? "border-green-300 text-green-700" : ""}`}>{e ? `Last ${when(e.receivedAt)}` : "Nothing yet"}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card p-6">
          <h2 className="mb-1 font-semibold">Recent activity</h2>
          <p className="mb-4 text-sm text-zinc-600">The last 50 events from the past 30 days. Phone numbers and message text are not kept here.</p>
          {!events.length && <p className="text-sm text-zinc-600">No events yet. Once Meta is connected, send a message to your WhatsApp number to test it.</p>}
          {events.length > 0 && (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}><td className="whitespace-nowrap text-zinc-600">{when(e.receivedAt)}</td><td className="whitespace-nowrap">{KIND_LABEL[e.kind]}</td><td>{e.detail}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
