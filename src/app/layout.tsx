import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ConnectionStatus } from "@/components/ConnectionStatus";

export const metadata: Metadata = { title: { default: "Waky Booking", template: "%s · Waky Booking" }, description: "Waky Booking: appointments, payments and reminders" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
        <ConnectionStatus />
      </body>
    </html>
  );
}
