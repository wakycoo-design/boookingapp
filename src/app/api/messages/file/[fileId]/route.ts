import { app } from "@/features/container";
import { chatRoute } from "@/lib/chat-route";

export const dynamic = "force-dynamic";

/** GET: an attachment, only for people in its conversation. */
export const GET = chatRoute<{ fileId: string }>(async (_req, me, { fileId }) => {
  const f = await app().messages.attachment(me, fileId);
  const name = encodeURIComponent(f.fileName);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${name}`,
      // Files are only images and PDFs; this keeps the browser from guessing any other type.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
