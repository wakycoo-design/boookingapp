import type { Actor } from "@/features/audit/audit.types";
import type { SettingsRepository } from "./settings.repository";
import { settingsInput, type SettingsInput } from "./settings.schemas";

export function createSettingsService({ settingsRepo }: { settingsRepo: SettingsRepository }) {
  return {
    get: () => settingsRepo.get(),

    update(actor: Actor, input: SettingsInput) {
      const data = settingsInput.parse(input);
      return settingsRepo.update(data, { actor, action: "update", entity: "business", entityId: "1", details: data });
    },

    /** Saves one settings page: the fields it sends replace the stored ones, everything else stays as it is. */
    async updatePart(actor: Actor, part: Partial<SettingsInput>) {
      const data = settingsInput.parse({ ...(await settingsRepo.get()), ...part });
      return settingsRepo.update(data, { actor, action: "update", entity: "business", entityId: "1", details: part });
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
