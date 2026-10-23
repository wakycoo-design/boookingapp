import { app } from "@/features/container";
import { chatRoute } from "@/lib/chat-route";

export const dynamic = "force-dynamic";

/** GET: my conversations, newest first, with unread counts. */
export const GET = chatRoute(async (_req, me) => app().messages.list(me));
