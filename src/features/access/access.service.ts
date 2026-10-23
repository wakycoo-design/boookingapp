import type { Actor } from "@/features/audit/audit.types";
import { DomainError } from "@/features/shared/errors";
import { isUuid } from "@/features/shared/validation";
import { permissionKey, type PermissionMatrix, type Permissions, type RoleDTO } from "./access.dto";
import type { AccessRepository, Override } from "./access.repository";
import { ACTIONS, defaultAllows, FEATURES, type Action, type BaseRole } from "./features";

const ALL_KEYS: Permissions = new Set(FEATURES.flatMap((f) => f.actions.map((a) => permissionKey(f.key, a))));

/**
 * Roles and what each may do. Only ticks an admin changed are stored; everything else follows the defaults of the role's
 * base (features.ts), so a feature added later reaches every role without anyone touching it. Admins can always do
 * everything, and the Admin role can't be narrowed, so nobody can lock the firm out.
 */
export function createAccessService({ accessRepo }: { accessRepo: AccessRepository }) {
  async function getRole(id: string): Promise<RoleDTO> {
    const row = isUuid(id) ? await accessRepo.findRole(id) : null;
    if (!row) throw new DomainError("not_found", `Role ${id} not found`);
    return row;
  }

  function effective(base: BaseRole, overrides: Override[]): Permissions {
    if (base === "admin") return ALL_KEYS;
    const changed = new Map(overrides.map((o) => [`${o.feature}:${o.action}`, o.allowed]));
    const out = new Set<string>();
    for (const f of FEATURES) {
      for (const a of f.actions) {
        const key = permissionKey(f.key, a);
        if (changed.get(key) ?? defaultAllows(base, f.key, a)) out.add(key);
      }
    }
    return out;
  }

  /** The role someone has: their own, or the built-in role for their base if none is set yet. */
  async function roleOf(member: { role: BaseRole; roleId?: string | null }): Promise<RoleDTO | null> {
    return (member.roleId && (await accessRepo.findRole(member.roleId))) || accessRepo.systemRole(member.role);
  }

  function cleanName(raw: string) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name || name.length > 60) throw new DomainError("invalid", "Give the role a name of up to 60 characters");
    return name;
  }

  return {
    getRole,
    roles: () => accessRepo.listRoles(),
    roleOf,
    systemRole: (base: BaseRole) => accessRepo.systemRole(base),

    /** Everything this person may do, as "feature:action". */
    async permissionsFor(member: { role: BaseRole; roleId?: string | null }): Promise<Permissions> {
      if (member.role === "admin") return ALL_KEYS;
      const r = await roleOf(member);
      return effective(member.role, r ? await accessRepo.overrides(r.id) : []);
    },

    /** The permissions page for one role: every tick, and whether it differs from the default. */
    async matrix(roleId: string): Promise<{ role: RoleDTO; matrix: PermissionMatrix }> {
      const r = await getRole(roleId);
      const allowed = effective(r.base, await accessRepo.overrides(r.id));
      const matrix: PermissionMatrix = {};
      for (const f of FEATURES) {
        matrix[f.key] = {};
        for (const a of f.actions) {
          const on = allowed.has(permissionKey(f.key, a));
          matrix[f.key][a] = { allowed: on, changed: on !== defaultAllows(r.base, f.key, a) };
        }
      }
      return { role: r, matrix };
    },

    /** Saves a role's ticks. Only the differences from its defaults are stored. */
    async saveMatrix(actor: Actor, roleId: string, ticked: Iterable<string>) {
      const r = await getRole(roleId);
      if (r.base === "admin") throw new DomainError("forbidden", "Admins can always do everything, so the Admin role can't be changed");
      const on = new Set(ticked);
      const overrides: Override[] = [];
      for (const f of FEATURES) {
        for (const a of f.actions) {
          // "Everyone's" only makes sense together with "view".
          const allowed = on.has(permissionKey(f.key, a)) && (a !== "viewAll" || on.has(permissionKey(f.key, "view")));
          if (allowed !== defaultAllows(r.base, f.key, a)) overrides.push({ feature: f.key, action: a, allowed });
        }
      }
      await accessRepo.replaceOverrides(r.id, overrides, { actor, action: "update", entity: "role_permissions", entityId: r.id, details: { changed: overrides.length } });
    },

    /** A new role starts as a copy of another: same base, same changed ticks. */
    async createRole(actor: Actor, input: { name: string; copyFrom: string }) {
      const name = cleanName(input.name);
      const source = await getRole(input.copyFrom);
      if (await accessRepo.nameTaken(name)) throw new DomainError("conflict", `There is already a role called "${name}"`);
      if (source.base === "admin") throw new DomainError("invalid", "Copy a Manager or Staff role; there is only one Admin role");
      return accessRepo.createRole({ name, base: source.base }, await accessRepo.overrides(source.id), { actor, action: "create", entity: "role" });
    },

    async renameRole(actor: Actor, id: string, rawName: string) {
      const r = await getRole(id);
      if (r.system) throw new DomainError("invalid", "The built-in roles keep their names");
      const name = cleanName(rawName);
      if (await accessRepo.nameTaken(name, id)) throw new DomainError("conflict", `There is already a role called "${name}"`);
      await accessRepo.renameRole(id, name, { actor, action: "update", entity: "role", entityId: id, details: { name } });
    },

    async removeRole(actor: Actor, id: string) {
      const r = await getRole(id);
      if (r.system) throw new DomainError("invalid", "The built-in roles can't be deleted");
      if (r.staffCount) throw new DomainError("conflict", `${r.staffCount} staff ${r.staffCount === 1 ? "member has" : "members have"} the role "${r.name}". Give them another role first.`);
      await accessRepo.removeRole(id, { actor, action: "delete", entity: "role", entityId: id });
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;
export { ACTIONS, type Action };
