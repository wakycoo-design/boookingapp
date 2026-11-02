import Link from "next/link";

/** Switches between team chats and clients' WhatsApp chats; shows only the tabs this person may open. */
export function MessagesTabs({ active, showTeam, showWhatsApp }: { active: "team" | "whatsapp"; showTeam: boolean; showWhatsApp: boolean }) {
  const tab = (key: "team" | "whatsapp", href: string, label: string) => (
    <Link href={href} aria-current={active === key ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm ${active === key ? "bg-zinc-900 font-medium text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Messages" className="flex gap-1">
      {showTeam && tab("team", "/admin/messages", "Team")}
      {showWhatsApp && tab("whatsapp", "/admin/messages/whatsapp", "WhatsApp")}
    </nav>
  );
}
