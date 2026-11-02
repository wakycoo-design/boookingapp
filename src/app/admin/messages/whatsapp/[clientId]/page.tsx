import { WhatsAppView } from "../view";

export const dynamic = "force-dynamic";

export default async function WhatsAppChatPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <WhatsAppView clientId={clientId} />;
}
