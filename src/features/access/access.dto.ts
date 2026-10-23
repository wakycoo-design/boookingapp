import type { Action, BaseRole } from "./features";

export type RoleDTO = { id: string; name: string; base: BaseRole; system: boolean; staffCount: number };

/** One tick on the permissions page: allowed or not, and whether it is still the default. */
export type PermissionCell = { allowed: boolean; changed: boolean };
export type PermissionMatrix = Record<string, Partial<Record<Action, PermissionCell>>>;

/** "feature:action" for everything someone may do. */
export type Permissions = ReadonlySet<string>;
export const permissionKey = (feature: string, action: Action) => `${feature}:${action}`;
