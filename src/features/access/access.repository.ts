import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { role, rolePermission } from "@/db/schema";
import { writeAudit } from "@/features/audit/audit.repository";
import type { AuditEntry } from "@/features/audit/audit.types";
import type { RoleDTO } from "./access.dto";
import type { BaseRole } from "./features";

export type Override = { feature: string; action: string; allowed: boolean };

const columns = {
  id: role.id,
  name: role.name,
  base: role.base,
  system: role.system,
  // Written out in full: inside a subquery Drizzle leaves column names unqualified, and "id" would mean the staff's own.
  staffCount: sql<number>`(select count(*)::int from "staff" where "staff"."role_id" = "role"."id")`,
};

export function createAccessRepository(db: Db) {
  return {
    listRoles(): Promise<RoleDTO[]> {
      return db.select(columns).from(role).orderBy(sql`${role.system} desc`, asc(role.name));
    },

    async findRole(id: string): Promise<RoleDTO | null> {
      const [row] = await db.select(columns).from(role).where(eq(role.id, id));
      return row ?? null;
    },

    async systemRole(base: BaseRole): Promise<RoleDTO | null> {
      const [row] = await db.select(columns).from(role).where(and(eq(role.base, base), eq(role.system, true)));
      return row ?? null;
    },

    overrides(roleId: string): Promise<Override[]> {
      return db.select({ feature: rolePermission.feature, action: rolePermission.action, allowed: rolePermission.allowed }).from(rolePermission).where(eq(rolePermission.roleId, roleId));
    },

    /** Replaces everything changed for a role in one go. */
    replaceOverrides(roleId: string, rows: Override[], audit: AuditEntry): Promise<void> {
      return db.transaction(async (tx) => {
        await tx.delete(rolePermission).where(eq(rolePermission.roleId, roleId));
        if (rows.length) await tx.insert(rolePermission).values(rows.map((r) => ({ roleId, ...r })));
        await writeAudit(tx, audit);
      });
    },

    createRole(data: { name: string; base: BaseRole }, copy: Override[], audit: Omit<AuditEntry, "entityId">): Promise<string> {
      return db.transaction(async (tx) => {
        const [row] = await tx.insert(role).values({ ...data, system: false }).returning({ id: role.id });
        if (copy.length) await tx.insert(rolePermission).values(copy.map((r) => ({ roleId: row.id, ...r })));
        await writeAudit(tx, { ...audit, entityId: row.id });
        return row.id;
      });
    },

    async renameRole(id: string, name: string, audit: AuditEntry): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.update(role).set({ name }).where(eq(role.id, id));
        await writeAudit(tx, audit);
      });
    },

    async removeRole(id: string, audit: AuditEntry): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.delete(role).where(eq(role.id, id));
        await writeAudit(tx, audit);
      });
    },

    async nameTaken(name: string, exceptId?: string): Promise<boolean> {
      const rows = await db.select({ id: role.id }).from(role).where(sql`lower(${role.name}) = ${name.trim().toLowerCase()}`);
      return rows.some((r) => r.id !== exceptId);
    },
  };
}

export type AccessRepository = ReturnType<typeof createAccessRepository>;
