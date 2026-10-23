import { createHash, randomBytes } from "node:crypto";
import type { Actor } from "@/features/audit/audit.types";
import { DomainError } from "@/features/shared/errors";
import { decoyHash, hashPassword, verifyPassword } from "@/lib/password";
import { isUuid } from "@/features/shared/validation";
import type { StaffDTO, StaffRole } from "./staff.dto";
import type { StaffRepository } from "./staff.repository";
import { staffInput, type StaffInput } from "./staff.schemas";

const RESET_LINK_LIFETIME_MS = 60 * 60 * 1000;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function createStaffService({
  staffRepo,
  sendResetLink,
  roles,
}: {
  staffRepo: StaffRepository;
  /** Keeps a person's role and its base in step. Left out in a few narrow tests. */
  roles?: { baseOf: (roleId: string) => Promise<StaffRole>; builtIn: (base: StaffRole) => Promise<string | null> };
  /** Emails the "choose a new password" link. Left out where no mail is set up (the request then does nothing visible). */
  sendResetLink?: (to: { name: string; email: string }, token: string) => Promise<void>;
}) {
  async function get(id: string): Promise<StaffDTO> {
    const row = isUuid(id) ? await staffRepo.findById(id) : null;
    if (!row) throw new DomainError("not_found", `Staff member ${id} not found`);
    return row;
  }

  /** A role id sets the base; a base alone gets its built-in role. */
  async function withRole<T extends { role?: StaffRole; roleId?: string | null }>(data: T): Promise<T> {
    if (!roles) return data;
    if (data.roleId) return { ...data, role: await roles.baseOf(data.roleId) };
    if (data.role) return { ...data, roleId: await roles.builtIn(data.role) };
    return data;
  }

  async function create(actor: Actor, input: StaffInput): Promise<StaffDTO> {
    const data = await withRole(staffInput.parse(input));
    if (await staffRepo.findByEmail(data.email)) {
      throw new DomainError("conflict", `A staff member with email ${data.email} already exists`);
    }
    return staffRepo.create(data, {
      actor,
      action: "create",
      entity: "staff",
      details: { email: data.email, role: data.role },
    });
  }

  async function update(actor: Actor, id: string, input: Partial<StaffInput>): Promise<StaffDTO> {
    const data = await withRole(staffInput.partial().parse(input));
    await get(id);
    if (data.email) {
      const other = await staffRepo.findByEmail(data.email);
      if (other && other.id !== id) {
        throw new DomainError("conflict", `A staff member with email ${data.email} already exists`);
      }
    }
    const row = await staffRepo.update(id, data, { actor, action: "update", entity: "staff", entityId: id, details: data });
    if (!row) throw new DomainError("not_found", `Staff member ${id} not found`);
    return row;
  }

  return {
    get,
    create,
    update,
    list: () => staffRepo.list(),
    serviceIds: (staffId: string) => staffRepo.serviceIds(staffId),
    listBookableForService: (serviceId: string) => staffRepo.listBookableForService(serviceId),

    async setServices(actor: Actor, staffId: string, serviceIds: string[]) {
      const unique = [...new Set(serviceIds)];
      await staffRepo.replaceServices(staffId, unique, {
        actor,
        action: "set_services",
        entity: "staff",
        entityId: staffId,
        details: { serviceIds: unique },
      });
    },

    servicePrices: (staffId: string) => staffRepo.servicePrices(staffId),

    /** Sets what this person charges for services they offer, in paise. Null (or leaving it out) uses the service's price. */
    async setServicePrices(actor: Actor, staffId: string, prices: Record<string, number | null>) {
      for (const [serviceId, p] of Object.entries(prices)) {
        if (p !== null && (!Number.isInteger(p) || p < 0 || p > 100_000_000)) {
          throw new DomainError("invalid", `Price for service ${serviceId} must be a whole number of paise from 0 to 100000000`);
        }
      }
      await staffRepo.setServicePrices(staffId, prices, { actor, action: "set_service_prices", entity: "staff", entityId: staffId, details: { prices } });
    },

    /** Sets (or replaces) the password this person signs in with. The password itself is never stored or logged. */
    async setPassword(actor: Actor, id: string, password: string) {
      if (password.length < 8 || password.length > 200) {
        throw new DomainError("invalid", "A password must be 8 to 200 characters long");
      }
      await get(id);
      const ok = await staffRepo.setPasswordHash(id, await hashPassword(password), { actor, action: "set_password", entity: "staff", entityId: id });
      if (!ok) throw new DomainError("not_found", `Staff member ${id} not found`);
    },

    /**
     * Emails a one-time link to choose a new password. Says nothing about whether the address belongs to anyone, so it can't be used
     * to find out who works here; a mail failure is logged and equally invisible to the caller.
     */
    async requestPasswordReset(email: string): Promise<void> {
      const member = await staffRepo.findByEmail(email);
      if (!member || !member.active) return;
      const token = randomBytes(32).toString("base64url");
      if (!(await staffRepo.setResetToken(member.id, sha256(token), new Date(Date.now() + RESET_LINK_LIFETIME_MS)))) return;
      try {
        await sendResetLink?.(member, token);
      } catch (err) {
        console.error("[password-reset] could not send the email:", err instanceof Error ? err.message : err);
      }
    },

    /** Sets a new password from the emailed link. The link works once and for an hour. */
    async resetPassword(token: string, password: string): Promise<void> {
      if (password.length < 8 || password.length > 200) throw new DomainError("invalid", "A password must be 8 to 200 characters long");
      const ok = await staffRepo.resetPasswordWithToken(sha256(token), await hashPassword(password), { actor: {}, action: "reset_password", entity: "staff" });
      if (!ok) throw new DomainError("invalid", "This reset link is not valid any more. Ask for a new one.");
    },

    /** The active staff member whose email and password match, else null. Does the same work either way so timing reveals nothing. */
    async verifyPassword(email: string, password: string): Promise<StaffDTO | null> {
      const [member, hash] = await Promise.all([staffRepo.findByEmail(email), staffRepo.passwordHashByEmail(email)]);
      const matches = await verifyPassword(password, hash ?? (await decoyHash));
      return member && member.active && hash && matches ? member : null;
    },

    /**
     * Called on every Google sign-in. Active staff may log in; emails listed in ADMIN_EMAILS
     * are created as admins on first login so the firm can bootstrap without a seed script.
     */
    async resolveLogin(login: { email: string; name?: string | null }, bootstrapAdmins: string[]) {
      const email = login.email.trim().toLowerCase();
      const existing = await staffRepo.findByEmail(email);
      if (existing) return existing.active ? existing : null;
      if (!bootstrapAdmins.includes(email)) return null;
      return create({}, { name: login.name?.trim() || email, email, role: "admin" });
    },
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
