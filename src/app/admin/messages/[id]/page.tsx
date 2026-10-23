import { MessagesView } from "../view";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MessagesView selectedId={id} />;
}
