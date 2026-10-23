import { beforeEach, describe, expect, it } from "vitest";
import { c, reset } from "./helpers";
import type { Chatter } from "@/features/messages/messages.service";

beforeEach(reset);

async function person(name: string, role: "admin" | "manager" | "staff", roleId?: string): Promise<Chatter> {
  const s = await c.staff.create({}, { name, email: `${name.toLowerCase().replace(/\W/g, "")}@firm.test`, role, ...(roleId ? { roleId } : {}) });
  return { id: s.id, name: s.name, roleId: s.roleId, permissions: await c.access.permissionsFor(s) };
}

const everyoneId = async (me: Chatter) => (await c.messages.list(me)).find((x) => x.kind === "everyone")!.id;

describe("team messages", () => {
  it("one-to-one: one chat per pair, private to the two of them, with seen-by", async () => {
    const admin = await person("Ameen", "admin");
    const asha = await person("Asha", "staff");
    const omar = await person("Omar", "staff");
    const id = await c.messages.startDirect(asha, admin.id);
    expect(await c.messages.startDirect(admin, asha.id)).toBe(id);
    await c.messages.send(asha, id, { body: "Can I move my 3 pm?" });
    expect((await c.messages.list(admin)).find((x) => x.id === id)).toMatchObject({ title: "Asha", unread: 1, preview: "Asha: Can I move my 3 pm?" });
    let [m] = await c.messages.messages(asha, id);
    expect(m.seenBy).toEqual([]);
    await c.messages.markRead(admin, id);
    [m] = await c.messages.messages(asha, id);
    expect(m.seenBy.map((s) => s.name)).toEqual(["Ameen"]);
    expect((await c.messages.list(admin)).find((x) => x.id === id)?.unread).toBe(0);
    await expect(c.messages.messages(omar, id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("everyone: the whole team is in it, everyone can reply, new people join by themselves", async () => {
    const admin = await person("Ameen", "admin");
    const asha = await person("Asha", "staff");
    const all = await everyoneId(admin);
    await c.messages.send(admin, all, { body: "Team meeting at 5" });
    await c.messages.send(asha, all, { body: "Noted" });
    const late = await person("Zara", "staff");
    expect((await c.messages.conversation(late, all)).members.map((p) => p.name)).toEqual(["Ameen", "Asha", "Zara"]);
    await c.messages.markRead(asha, all);
    const [first] = await c.messages.messages(admin, all);
    expect(first.seenBy.map((s) => s.name)).toEqual(["Asha"]);
  });

  it("role conversations need the announcement permission, and only that role's people are in them", async () => {
    const admin = await person("Ameen", "admin");
    const asha = await person("Asha", "staff");
    const coordinator = await c.access.createRole({}, { name: "Consultation coordinator", copyFrom: (await c.access.systemRole("staff"))!.id });
    const cora = await person("Cora", "staff", coordinator);
    await expect(c.messages.roleConversation(asha, coordinator)).rejects.toMatchObject({ code: "forbidden" });
    const id = await c.messages.roleConversation(admin, coordinator);
    expect(await c.messages.roleConversation(admin, coordinator)).toBe(id);
    await c.messages.send(admin, id, { body: "New intake flow from Monday" });
    expect((await c.messages.list(cora)).map((x) => x.title)).toContain("All Consultation coordinator");
    await expect(c.messages.messages(asha, id)).rejects.toMatchObject({ code: "forbidden" });
    await c.messages.send(cora, id, { body: "Got it" });
  });

  it("groups: chosen people only", async () => {
    const admin = await person("Ameen", "admin");
    const asha = await person("Asha", "staff");
    const omar = await person("Omar", "staff");
    const id = await c.messages.createGroup(asha, { title: "Weekend cover", memberIds: [admin.id] });
    expect((await c.messages.conversation(admin, id)).members.map((p) => p.name)).toEqual(["Ameen", "Asha"]);
    await expect(c.messages.send(omar, id, { body: "hi" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(c.messages.createGroup(asha, { title: "Alone", memberIds: [] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("edit and delete your own; moderators can delete others'", async () => {
    const admin = await person("Ameen", "admin");
    const asha = await person("Asha", "staff");
    const all = await everyoneId(admin);
    const mine = await c.messages.send(asha, all, { body: "Typo heer" });
    await c.messages.edit(asha, mine, "Typo here");
    await expect(c.messages.edit(admin, mine, "Changed")).rejects.toMatchObject({ code: "forbidden" });
    let [m] = await c.messages.messages(admin, all);
    expect(m).toMatchObject({ body: "Typo here", editedAt: expect.any(Date) });
    const theirs = await c.messages.send(admin, all, { body: "Admin note" });
    await expect(c.messages.remove(asha, theirs)).rejects.toMatchObject({ code: "forbidden" });
    await c.messages.remove(admin, mine);
    [m] = await c.messages.messages(asha, all);
    expect(m).toMatchObject({ deleted: true, body: "" });
  });

  it("mentions put a notification in the bell", async () => {
    const admin = await person("Ameen Sha", "admin");
    const asha = await person("Asha Rao", "staff");
    const all = await everyoneId(admin);
    await c.messages.send(admin, all, { body: "@Asha Rao please check the 4 pm" });
    expect((await c.inbox.list(asha.id)).map((n) => n.title)).toEqual(["Ameen Sha mentioned you in Everyone"]);
  });

  it("only take images and PDFs up to 5 MB, and serve them only to members", async () => {
    const admin = await person("Ameen", "admin");
    const asha = await person("Asha", "staff");
    const omar = await person("Omar", "staff");
    const id = await c.messages.startDirect(admin, asha.id);
    await expect(c.messages.send(admin, id, { body: "", files: [{ fileName: "x.exe", contentType: "application/octet-stream", data: Buffer.from("x") }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(c.messages.send(admin, id, { body: "", files: [{ fileName: "big.pdf", contentType: "application/pdf", data: Buffer.alloc(5 * 1024 * 1024 + 1) }] })).rejects.toMatchObject({ code: "invalid" });
    await c.messages.send(admin, id, { body: "Report", files: [{ fileName: "report.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4") }] });
    const [m] = await c.messages.messages(asha, id);
    expect(m.attachments).toEqual([expect.objectContaining({ fileName: "report.pdf", contentType: "application/pdf", size: 8 })]);
    expect((await c.messages.attachment(asha, m.attachments[0].id)).data.toString()).toBe("%PDF-1.4");
    await expect(c.messages.attachment(omar, m.attachments[0].id)).rejects.toMatchObject({ code: "forbidden" });
  });
});
