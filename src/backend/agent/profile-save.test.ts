import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfileDraft } from "@openbot/contracts/ipc";
import { afterEach, expect, it, vi } from "vitest";
import { AgentStore } from "../agent-store";
import { SidebarLayoutStore } from "../sidebar-layout-store";
import { ProfileSave } from "./profile-save";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const draft: AgentProfileDraft = {
  name: "Researcher",
  title: "Research assistant",
  description: "Compare primary sources and cite conclusions.",
  avatarSeed: "profile:research",
  avatarHue: 215,
  sectionId: null,
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbot-profile-save-"));
  const store = new AgentStore(join(root, "data"), join(root, "home"));
  await store.initialize();
  const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
  await sidebar.initialize();
  const save = new ProfileSave(store, {
    create: async (input, configure) => configure(await store.createAgent(input.draft)),
    changed: () => undefined,
    delete: async (id) => {
      await store.deleteAgent(id);
    },
  });
  cleanups.push(async () => {
    store.database.close();
    await rm(root, { recursive: true, force: true });
  });
  return { store, sidebar, save, root };
}

it("persists a reviewed profile and section, and retries without creating another agent", async () => {
  const { store, sidebar, save } = await fixture();
  const layout = await sidebar.mutate({ type: "create", name: "Research" }, new Set());
  const sectionId = layout.sections[0]?.id ?? "";
  const input = { operationId: randomUUID(), draft: { ...draft, sectionId }, initialMessage: "Hello" };
  const first = await save.save(input, sidebar);
  expect(first.agent).toMatchObject({
    name: draft.name,
    title: draft.title,
    description: draft.description,
    avatarHue: 215,
  });
  expect(first.layout.agentAssignments[first.agent.id]).toBe(sectionId);
  expect((await save.save(input, sidebar)).agent.id).toBe(first.agent.id);
  expect(store.list()).toHaveLength(1);
  store.database.close();
  await store.initialize();
  await sidebar.initialize();
  expect(store.list()[0]).toMatchObject({ id: first.agent.id, description: draft.description, title: draft.title });
  expect(sidebar.getSnapshot().agentAssignments[first.agent.id]).toBe(sectionId);
  expect((await save.save(input, sidebar)).agent.id).toBe(first.agent.id);
});

it("keeps identity and conversation state when applying reviewed instructions", async () => {
  const { store, sidebar, save } = await fixture();
  const agent = await store.createAgent({ ...draft, name: "Original" });
  const result = await save.save({ operationId: randomUUID(), agentId: agent.id, draft }, sidebar);
  expect(result.agent).toMatchObject({
    id: agent.id,
    workspacePath: agent.workspacePath,
    threadId: agent.threadId,
    provider: agent.provider,
    model: agent.model,
    description: draft.description,
  });
});

it("rejects a deleted section before creating or modifying an agent", async () => {
  const { store, sidebar, save } = await fixture();
  await expect(
    save.save(
      { operationId: randomUUID(), draft: { ...draft, sectionId: randomUUID() }, initialMessage: "Hello" },
      sidebar,
    ),
  ).rejects.toThrow("Unknown sidebar section");
  expect(store.list()).toEqual([]);
});

it("restores the previous profile and section when the save receipt cannot persist", async () => {
  const { store, sidebar, save } = await fixture();
  const agent = await store.createAgent({ ...draft, name: "Original", description: "Original instructions" });
  const layout = await sidebar.mutate({ type: "create", name: "Research" }, new Set([agent.id]));
  const dispatch = store.database.dispatch.bind(store.database);
  vi.spyOn(store.database, "dispatch").mockImplementation((id, events, result) => {
    if (id.startsWith("agent-profile:")) throw new Error("Disk full");
    return dispatch(id, events, result);
  });
  await expect(
    save.save(
      { operationId: randomUUID(), agentId: agent.id, draft: { ...draft, sectionId: layout.sections[0]?.id ?? null } },
      sidebar,
    ),
  ).rejects.toThrow("Disk full");
  expect(store.list()[0]).toMatchObject({ name: "Original", description: "Original instructions" });
  expect(sidebar.getSnapshot().agentAssignments[agent.id]).toBeUndefined();
  store.database.close();
  await store.initialize();
  await sidebar.initialize();
  expect(store.list()[0]?.name).toBe("Original");
  expect(sidebar.getSnapshot().agentAssignments[agent.id]).toBeUndefined();
});

it("removes an incomplete new agent and its assignment when profile persistence fails", async () => {
  const { store, sidebar, save } = await fixture();
  const layout = await sidebar.mutate({ type: "create", name: "Research" }, new Set());
  const input = {
    operationId: randomUUID(),
    initialMessage: "Hello",
    draft: { ...draft, sectionId: layout.sections[0]?.id ?? null },
  };
  const failure = vi.spyOn(store, "saveReviewedProfile").mockImplementationOnce(() => {
    throw new Error("Disk full");
  });
  await expect(save.save(input, sidebar)).rejects.toThrow("Disk full");
  expect(store.list()).toEqual([]);
  expect(sidebar.getSnapshot().agentAssignments).toEqual({});
  failure.mockRestore();
  const result = await save.save(input, sidebar);
  expect(store.list()).toHaveLength(1);
  expect(sidebar.getSnapshot().agentAssignments[result.agent.id]).toBe(input.draft.sectionId);
});
