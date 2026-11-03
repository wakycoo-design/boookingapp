import { beforeEach, describe, expect, it } from "vitest";
import { c, reset } from "./helpers";

type Person = { id: string; role: "admin" | "manager" | "staff"; name: string; email: string };
let admin: Person;
let other: Person;
const by = (p: Person) => ({ id: p.id, role: p.role });
const make = async (name: string, role: Person["role"]) => c.staff.create({}, { name, email: `${name.toLowerCase()}@firm.test`, role });

beforeEach(async () => {
  await reset();
  admin = await make("Ameen", "admin");
  other = await make("Riya", "staff");
  await c.staff.setPassword({}, other.id, "first-password-1");
});

describe("user management: who may do what", () => {
  it("lets only admins change someone's access", async () => {
    const manager = await make("Manu", "manager");
    await expect(c.staff.deactivate(by(manager), other.id)).rejects.toThrow(/Only an admin/);
  });

  it("stops an admin removing their own access", async () => {
    await expect(c.staff.deactivate(by(admin), admin.id)).rejects.toThrow(/your own access/);
    await expect(c.staff.terminate(by(admin), admin.id)).rejects.toThrow(/your own access/);
  });

  it("never removes the last admin who can sign in", async () => {
    const second = await make("Sara", "admin");
    await c.staff.deactivate(by(second), admin.id);
    const third = await make("Tom", "admin");
    await c.staff.deactivate(by(third), second.id);
    // Tom is now the only active admin.
    await expect(c.staff.deactivate(by(admin), third.id)).rejects.toThrow(/only admin who can sign in/);
    await c.staff.reactivate(by(third), admin.id);
    await c.staff.deactivate(by(admin), third.id);
    await expect(c.staff.terminate(by(third), admin.id)).rejects.toThrow(/only admin who can sign in/);
  });
});

describe("user management: actions", () => {
  it("deactivates: no sign-in, every session ended, and it can be undone", async () => {
    const after = await c.staff.deactivate(by(admin), other.id);
    expect(after).toMatchObject({ active: false, sessionVersion: 1 });
    expect(await c.staff.verifyPassword(other.email, "first-password-1")).toBeNull();
    await c.staff.reactivate(by(admin), other.id);
    expect(await c.staff.verifyPassword(other.email, "first-password-1")).not.toBeNull();
  });

  it("signs someone out everywhere without switching them off", async () => {
    expect(await c.staff.signOutEverywhere(by(admin), other.id)).toMatchObject({ active: true, sessionVersion: 1 });
  });

  it("terminates: no access, password gone, off every service, and no plain reactivation", async () => {
    const svc = await c.catalog.create({}, { name: "Consult", durationMin: 30 });
    await c.staff.setServices({}, other.id, [svc.id]);
    const after = await c.staff.terminate(by(admin), other.id);
    expect(after).toMatchObject({ active: false, sessionVersion: 1 });
    expect(after?.terminatedAt).toBeInstanceOf(Date);
    expect(await c.staff.serviceIds(other.id)).toEqual([]);
    await expect(c.staff.reactivate(by(admin), other.id)).rejects.toThrow(/reinstate them instead/);
    await expect(c.staff.update({}, other.id, { active: true })).rejects.toThrow(/reinstate them/);
    await expect(c.staff.terminate(by(admin), other.id)).rejects.toThrow(/already terminated/);
  });

  it("reinstates a terminated person, who then needs a new password", async () => {
    await c.staff.terminate(by(admin), other.id);
    expect(await c.staff.reinstate(by(admin), other.id)).toMatchObject({ active: true, terminatedAt: null });
    expect(await c.staff.verifyPassword(other.email, "first-password-1")).toBeNull();
    await c.staff.adminSetPassword(by(admin), other.id, "second-password-2");
    expect(await c.staff.verifyPassword(other.email, "second-password-2")).not.toBeNull();
  });

  it("sets a temporary password, ends their other sessions, and refuses a short one", async () => {
    await c.staff.adminSetPassword(by(admin), other.id, "temporary-pass-9");
    expect(await c.staff.verifyPassword(other.email, "temporary-pass-9")).not.toBeNull();
    expect((await c.staff.get(other.id)).sessionVersion).toBe(1);
    await expect(c.staff.adminSetPassword(by(admin), other.id, "short")).rejects.toThrow(/8 to 200/);
  });
});
