import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfileDraft, SaveAgentProfileInput } from "@openbot/contracts/ipc";
import { saveReviewedAgentProfile } from "@openbot/team-client";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { AgentStore } from "../agent-store";
import { runTestEffect } from "../effect-test-runtime";
import { SidebarLayoutStore } from "../sidebar-layout-store";
import { ProfileCreationRecovery } from "./profile-creation-recovery";
import { ProfileSave, ProfileSaveFailed } from "./profile-save";

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
  await runTestEffect(store.initialize());
  const sidebar = new SidebarLayoutStore(join(root, "sidebar.json"));
  await runTestEffect(sidebar.initialize());
  const save = new ProfileSave(store, {
    create: (input, configure) =>
      store.createAgent(input.draft, input.operationId).pipe(
        Effect.mapError((failure) => new ProfileSaveFailed({ cause: failure.cause })),
        Effect.flatMap(configure),
      ),
    changed: () => undefined,
    delete: (agent) =>
      store.deleteAgent(agent.id).pipe(
        Effect.asVoid,
        Effect.mapError((failure) => new ProfileSaveFailed({ cause: failure.cause })),
      ),
  });
  cleanups.push(async () => {
    store.database.close();
    await rm(root, { recursive: true, force: true });
  });
  return { store, sidebar, save, root };
}

it("persists a reviewed profile and section, and retries without creating another agent", async () => {
  const { store, sidebar, save } = await fixture();
  const layout = await runTestEffect(sidebar.mutate({ type: "create", name: "Research" }, new Set()));
  const sectionId = layout.sections[0]?.id ?? "";
  const input = { operationId: randomUUID(), draft: { ...draft, sectionId }, initialMessage: "Hello" };
  const first = await runTestEffect(save.save(input, sidebar));
  expect(first.agent).toMatchObject({
    name: draft.name,
    title: draft.title,
    description: draft.description,
    avatarHue: 215,
  });
  expect(first.layout.agentAssignments[first.agent.id]).toBe(sectionId);
  expect((await runTestEffect(save.save(input, sidebar))).agent.id).toBe(first.agent.id);
  expect(store.list()).toHaveLength(1);
  store.database.close();
  await runTestEffect(store.initialize());
  await runTestEffect(sidebar.initialize());
  expect(store.list()[0]).toMatchObject({ id: first.agent.id, description: draft.description, title: draft.title });
  expect(sidebar.getSnapshot().agentAssignments[first.agent.id]).toBe(sectionId);
  expect((await runTestEffect(save.save(input, sidebar))).agent.id).toBe(first.agent.id);
});

it("keeps identity and conversation state when applying reviewed instructions", async () => {
  const { store, sidebar, save } = await fixture();
  const agent = await runTestEffect(store.createAgent({ ...draft, name: "Original" }));
  const result = await runTestEffect(save.save({ operationId: randomUUID(), agentId: agent.id, draft }, sidebar));
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
    runTestEffect(
      save.save(
        { operationId: randomUUID(), draft: { ...draft, sectionId: randomUUID() }, initialMessage: "Hello" },
        sidebar,
      ),
    ),
  ).rejects.toThrow("Unknown sidebar section");
  expect(store.list()).toEqual([]);
});

it("restores the previous profile and section when the save receipt cannot persist", async () => {
  const { store, sidebar, save } = await fixture();
  const agent = await runTestEffect(
    store.createAgent({ ...draft, name: "Original", description: "Original instructions" }),
  );
  const layout = await runTestEffect(sidebar.mutate({ type: "create", name: "Research" }, new Set([agent.id])));
  const dispatch = store.database.dispatch.bind(store.database);
  vi.spyOn(store.database, "dispatch").mockImplementation((id, events, result) => {
    if (id.startsWith("agent-profile:")) throw new Error("Disk full");
    return dispatch(id, events, result);
  });
  await expect(
    runTestEffect(
      save.save(
        {
          operationId: randomUUID(),
          agentId: agent.id,
          draft: { ...draft, sectionId: layout.sections[0]?.id ?? null },
        },
        sidebar,
      ),
    ),
  ).rejects.toThrow("Disk full");
  expect(store.list()[0]).toMatchObject({ name: "Original", description: "Original instructions" });
  expect(sidebar.getSnapshot().agentAssignments[agent.id]).toBeUndefined();
  store.database.close();
  await runTestEffect(store.initialize());
  await runTestEffect(sidebar.initialize());
  expect(store.list()[0]?.name).toBe("Original");
  expect(sidebar.getSnapshot().agentAssignments[agent.id]).toBeUndefined();
});

it("removes an incomplete new agent and its assignment when profile persistence fails", async () => {
  const { store, sidebar, save } = await fixture();
  const layout = await runTestEffect(sidebar.mutate({ type: "create", name: "Research" }, new Set()));
  const input = {
    operationId: randomUUID(),
    initialMessage: "Hello",
    draft: { ...draft, sectionId: layout.sections[0]?.id ?? null },
  };
  const failure = vi.spyOn(store, "saveReviewedProfile").mockImplementationOnce(() => {
    throw new Error("Disk full");
  });
  await expect(runTestEffect(save.save(input, sidebar))).rejects.toThrow("Disk full");
  expect(store.list()).toEqual([]);
  expect(sidebar.getSnapshot().agentAssignments).toEqual({});
  failure.mockRestore();
  const result = await runTestEffect(save.save(input, sidebar));
  expect(store.list()).toHaveLength(1);
  expect(sidebar.getSnapshot().agentAssignments[result.agent.id]).toBe(input.draft.sectionId);
  store.database.close();
  await runTestEffect(store.initialize());
  expect(store.list().map((agent) => agent.id)).toEqual([result.agent.id]);
});

it("reconciles a lost creation response before applying edited retry fields", async () => {
  const { store, sidebar, save } = await fixture();
  const original = { operationId: randomUUID(), initialMessage: "Hello", draft: { ...draft } };
  const send = async (input: SaveAgentProfileInput) => runTestEffect(save.save(input, sidebar));
  // The host commits, but the client never receives the response.
  const committed = await send(original);
  const edited = { ...original, operationId: randomUUID(), draft: { ...draft, name: "Revised researcher" } };
  const result = await runTestEffect(saveReviewedAgentProfile(send, edited, original));
  expect(result.agent.id).toBe(committed.agent.id);
  expect(result.agent.name).toBe("Revised researcher");
  expect(store.list()).toHaveLength(1);
  expect((await runTestEffect(saveReviewedAgentProfile(send, edited, original))).agent.id).toBe(committed.agent.id);
  expect(store.list()).toHaveLength(1);
});

it("allows correcting a rejected creation while retaining its original retry identity", async () => {
  const { store, sidebar, save } = await fixture();
  const original = { operationId: randomUUID(), initialMessage: "Hello", draft: { ...draft, sectionId: randomUUID() } };
  const send = async (input: SaveAgentProfileInput) => runTestEffect(save.save(input, sidebar));
  await expect(send(original)).rejects.toThrow("Unknown sidebar section");
  const edited = { ...original, operationId: randomUUID(), draft: { ...draft } };
  const result = await runTestEffect(saveReviewedAgentProfile(send, edited, original));
  expect(result.agent.name).toBe(draft.name);
  expect(store.list()).toHaveLength(1);
});

it("removes a profile workspace left before its agent row was written", async () => {
  const { store, root } = await fixture();
  const agentId = `agent-${randomUUID()}`;
  const workspaces = join(root, "home", "OpenBot", "Agents");
  const markers = join(root, "data", "agent-profile-creations");
  await runTestEffect(new ProfileCreationRecovery(markers, workspaces).begin(agentId, randomUUID()));
  await mkdir(join(workspaces, agentId));
  store.database.close();
  await runTestEffect(store.initialize());
  expect(store.list()).toEqual([]);
  await expect(readdir(workspaces)).resolves.toEqual([]);
  await expect(readdir(markers)).resolves.toEqual([]);
});
