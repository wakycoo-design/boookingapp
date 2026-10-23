import { z } from "zod";
import { timezone } from "@/features/shared/validation";
import { isInboxEvent } from "@/features/inbox/events";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use times like 09:00");

/** A blank form box means "not set". */
const emptyToNull = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" || v === undefined ? null : v), schema.nullable()).default(null);

export const settingsInput = z.object({
  name: z.string().trim().min(1).max(120),
  timezone,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like INR"),
  bookingPrefix: z.string().trim().max(10).regex(/^[A-Za-z0-9_-]*$/, "Use only letters, numbers, - and _ in the booking ID prefix"),
  slotIntervalMin: z.coerce.number().int().min(5).max(240),
  minNoticeMin: z.coerce.number().int().min(0).max(60 * 24 * 30),
  maxNoticeDays: z.coerce.number().int().min(1).max(730),
  clientCutoffMin: z.coerce.number().int().min(0).max(60 * 24 * 14),
  // Shown to clients, so a logo must be a web address and the colour a plain hex value (no CSS injection).
  logoUrl: emptyToNull(
    z.string().trim().url("Use a full web address starting with https://").max(500).refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Use an https:// address"),
  ),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #0f766e").default("#000000"),
  welcomeText: emptyToNull(z.string().trim().max(500)),
  resumeUrl: emptyToNull(z.string().trim().url("Use a full web address starting with https://").max(500).refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Use an https:// address")),
  onlinePayment: z.boolean().default(false),
  meetEnabled: z.boolean().default(false),
  emailBranded: z.boolean().default(true),
  email: emptyToNull(z.string().trim().toLowerCase().email("Enter a valid email address").max(200)),
  phone: emptyToNull(z.string().trim().max(40)),
  address: emptyToNull(z.string().trim().max(500)),
  weekStart: z.coerce.number().int().min(0).max(6).default(1),
  timeFormat: z.enum(["12h", "24h"]).default("12h"),
  businessHours: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm }))
    .max(28)
    .default([]),
  inAppEvents: z.array(z.string().refine(isInboxEvent, "Unknown notification event")).nullable().default(null),
});
export type SettingsInput = z.input<typeof settingsInput>;
