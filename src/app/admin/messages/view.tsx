import { app } from "@/features/container";
import { can, requirePermission } from "@/lib/session";
import { MessagesApp } from "@/components/messages/MessagesApp";

/** The messages screen, shared by /admin/messages and /admin/messages/<conversation>. */
export async function MessagesView({ selectedId }: { selectedId: string | null }) {
  const me = await requirePermission("messages", "view");
  const s = await app().settings.get();
  return (
    <MessagesApp
      me={{ id: me.id, name: me.name }}
      selectedId={selectedId}
      tz={s.timezone}
      bookingPrefix={s.bookingPrefix}
      canStart={can(me.permissions, "messages", "add")}
      canAnnounce={can(me.permissions, "messages.announcements", "add")}
      canModerate={can(me.permissions, "messages.moderate", "delete")}
      canLinkClients={can(me.permissions, "clients", "view")}
      canLinkBookings={can(me.permissions, "bookings", "view")}
    />
  );
}
