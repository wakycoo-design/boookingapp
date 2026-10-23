import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { business } from "@/db/schema";
import { writeAudit } from "@/features/audit/audit.repository";
import type { AuditEntry } from "@/features/audit/audit.types";
import type { BusinessSettingsDTO } from "./settings.dto";

const columns = {
  name: business.name,
  timezone: business.timezone,
  currency: business.currency,
  bookingPrefix: business.bookingPrefix,
  slotIntervalMin: business.slotIntervalMin,
  minNoticeMin: business.minNoticeMin,
  maxNoticeDays: business.maxNoticeDays,
  clientCutoffMin: business.clientCutoffMin,
  logoUrl: business.logoUrl,
  brandColor: business.brandColor,
  welcomeText: business.welcomeText,
  resumeUrl: business.resumeUrl,
  onlinePayment: business.onlinePayment,
  meetEnabled: business.meetEnabled,
  emailBranded: business.emailBranded,
  email: business.email,
  phone: business.phone,
  address: business.address,
  weekStart: business.weekStart,
  timeFormat: sql<"12h" | "24h">`${business.timeFormat}`,
  businessHours: business.businessHours,
};

export function createSettingsRepository(db: Db) {
  return {
    async get(): Promise<BusinessSettingsDTO> {
      const [row] = await db.select(columns).from(business).where(eq(business.id, 1));
      if (row) return row;
      // The migration inserts the row; recreate it if someone deleted it.
      const [created] = await db.insert(business).values({ id: 1 }).onConflictDoNothing().returning(columns);
      return created ?? (await db.select(columns).from(business).where(eq(business.id, 1)))[0];
    },

    update(data: BusinessSettingsDTO, audit: AuditEntry): Promise<BusinessSettingsDTO> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(business)
          .values({ id: 1, ...data })
          .onConflictDoUpdate({ target: business.id, set: data })
          .returning(columns);
        await writeAudit(tx, audit);
        return row;
      });
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
