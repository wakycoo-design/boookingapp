"use server";

import { app } from "@/features/container";
import { act } from "@/lib/form-actions";
import { requirePermission } from "@/lib/session";

export async function readAllNotificationsAction() {
  const me = await requirePermission("notifications", "view");
  await act("/admin/notifications", "All marked as read", () => app().inbox.readAll(me.id));
}
