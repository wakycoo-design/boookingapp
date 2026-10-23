import { beforeEach, describe, expect, it } from "vitest";
import { c, reset } from "./helpers";
import { permissionKey } from "@/features/access/access.dto";
import { FEATURES } from "@/features/access/features";

beforeEach(reset);

const builtIn = async (base: "admin" | "manager" | "staff") => (await c.access.systemRole(base))!;
const has = (perms: ReadonlySet<string>, feature: string, action: Parameters<typeof permissionKey>[1]) => perms.has(permissionKey(feature, action));

describe("roles and permissions", () => {
  it("start with what each role could do before roles existed", async () => {
    const staff = await c.access.permissionsFor({ role: "staff" });
    expect(has(staff, "bookings", "view")).toBe(true);
    expect(has(staff, "bookings", "viewAll")).toBe(false);
    expect(has(staff, "clients", "view")).toBe(false);
    expect(has(staff, "settings.organization", "view")).toBe(false);
    const manager = await c.access.permissionsFor({ role: "manager" });
    expect(has(manager, "clients", "edit")).toBe(true);
    expect(has(manager, "workflows", "view")).toBe(true);
    expect(has(manager, "workflows", "add")).toBe(false);
    expect(has(manager, "settings.roles", "view")).toBe(false);
    const admin = await c.access.permissionsFor({ role: "admin" });
    expect(FEATURES.every((f) => f.actions.every((a) => has(admin, f.key, a)))).toBe(true);
  });

  it("store only changed ticks, and follow them", async () => {
    const staff = await builtIn("staff");
    const { matrix } = await c.access.matrix(staff.id);
    const ticked = Object.entries(matrix).flatMap(([f, cells]) => Object.entries(cells).filter(([, cell]) => cell!.allowed).map(([a]) => `${f}:${a}`));
    await c.access.saveMatrix({}, staff.id, [...ticked, "clients:view"]);
    const after = await c.access.matrix(staff.id);
    expect(after.matrix.clients.view).toEqual({ allowed: true, changed: true });
    expect(after.matrix.bookings.view).toEqual({ allowed: true, changed: false });
    const member = await c.staff.create({}, { name: "Asha", email: "asha@firm.test" });
    expect(has(await c.access.permissionsFor(member), "clients", "view")).toBe(true);
  });

  it("only let 'everyone's' go with 'view'", async () => {
    const staff = await builtIn("staff");
    await c.access.saveMatrix({}, staff.id, ["bookings:viewAll"]);
    const perms = await c.access.permissionsFor({ role: "staff", roleId: staff.id });
    expect(has(perms, "bookings", "viewAll")).toBe(false);
  });

  it("never narrow the Admin role", async () => {
    await expect(c.access.saveMatrix({}, (await builtIn("admin")).id, [])).rejects.toMatchObject({ code: "forbidden" });
  });

  it("make a new role as a copy, following its base for anything unchanged", async () => {
    const staff = await builtIn("staff");
    await c.access.saveMatrix({}, staff.id, ["bookings:view", "bookings:add", "bookings:edit", "calendar:view", "clients:view"]);
    const id = await c.access.createRole({}, { name: "Receptionist", copyFrom: staff.id });
    const role = await c.access.getRole(id);
    expect(role).toMatchObject({ name: "Receptionist", base: "staff", system: false });
    const perms = await c.access.permissionsFor({ role: "staff", roleId: id });
    expect(has(perms, "clients", "view")).toBe(true); // copied change
    expect(has(perms, "caseHistories", "view")).toBe(false); // copied change: not ticked above
    await expect(c.access.createRole({}, { name: "receptionist", copyFrom: staff.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(c.access.createRole({}, { name: "Boss", copyFrom: (await builtIn("admin")).id })).rejects.toMatchObject({ code: "invalid" });
  });

  it("give a person their role's base, and a built-in role when only a base is given", async () => {
    const id = await c.access.createRole({}, { name: "Lead", copyFrom: (await builtIn("manager")).id });
    const lead = await c.staff.create({}, { name: "Lead", email: "lead@firm.test", roleId: id });
    expect(lead).toMatchObject({ role: "manager", roleId: id });
    const plain = await c.staff.create({}, { name: "Plain", email: "plain@firm.test", role: "staff" });
    expect(plain.roleId).toBe((await builtIn("staff")).id);
    const moved = await c.staff.update({}, plain.id, { roleId: id });
    expect(moved).toMatchObject({ role: "manager", roleId: id });
  });

  it("keep built-in roles, and roles still in use", async () => {
    await expect(c.access.removeRole({}, (await builtIn("staff")).id)).rejects.toMatchObject({ code: "invalid" });
    await expect(c.access.renameRole({}, (await builtIn("staff")).id, "Team")).rejects.toMatchObject({ code: "invalid" });
    const id = await c.access.createRole({}, { name: "Intern", copyFrom: (await builtIn("staff")).id });
    await c.staff.create({}, { name: "Intern", email: "intern@firm.test", roleId: id });
    await expect(c.access.removeRole({}, id)).rejects.toMatchObject({ code: "conflict" });
    await c.access.renameRole({}, id, "Trainee");
    expect((await c.access.getRole(id)).name).toBe("Trainee");
  });
});
