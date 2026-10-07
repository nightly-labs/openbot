// @vitest-environment node
import { mkdir, readFile, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AgentService } from "./agent-service";
import {
  paramsRecord,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitFor,
  waitForQueue,
} from "./agent-service-test-harness";
import { AgentStore } from "./agent-store";
import { runCauseEffect } from "./effect-boundary";

// Failure modes: session reuse after a path change; lost public history; deleted external data;
// lost path on restart/replay; a directory switch during pending work; an invalid path persisted.
let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

it("changes the provider folder without changing the public thread or managed workspace", async () => {
  const started = await startService(root, { provider: "codex", output: "DONE", preferredProvider: "codex" });
  service = started.service;
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Remember this conversation." }));
  await waitForQueue(service, "chief", (queue) => queue.deliveries.every((item) => item.status === "completed"));
  const previous = service.listAgents().find((agent) => agent.id === "chief");
  if (!previous?.threadId) throw new Error("Missing agent.");
  const oldSession = started.store.activeProviderSession("chief")?.externalSessionId;
  const repository = join(root, "repository");
  await mkdir(repository);
  const alias = join(root, "repository-link");
  await symlink(repository, alias);
  await runCauseEffect(service.setWorkingDirectory("chief", alias));
  const changed = service.listAgents().find((agent) => agent.id === "chief");
  expect(changed).toMatchObject({
    workspacePath: previous.workspacePath,
    threadId: previous.threadId,
    workingDirectory: await realpath(repository),
  });
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Continue in the selected folder." }));
  await waitForQueue(service, "chief", (queue) => queue.deliveries.every((item) => item.status === "completed"));
  expect(started.store.activeProviderSession("chief")?.externalSessionId).not.toBe(oldSession);
  const turn = started.client.requests.filter((item) => item.method === "turn/start").at(-1);
  expect(paramsRecord(turn?.params)?.cwd).toBe(await realpath(repository));
  expect(paramsRecord(turn?.params)?.runtimeWorkspaceRoots).toContain(previous.workspacePath);
  const conversation = await runCauseEffect(service.readConversation("chief"));
  expect(JSON.stringify(conversation)).toContain("Remember this conversation.");
  await waitFor(() => service !== null && !service.workingDirectoryBusy("chief"));
  await runCauseEffect(service.setWorkingDirectory("chief", null));
  expect(service.listAgents().find((agent) => agent.id === "chief")?.workingDirectory).toBeUndefined();
});

it("keeps the selected repository through restart, duplication and agent removal", async () => {
  const userData = join(root, "user-data");
  const home = join(root, "home");
  const store = new AgentStore(userData, home);
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(store.getOrCreate("chief"));
  const repository = join(root, "repository");
  await mkdir(repository);
  await writeFile(join(repository, "keep.txt"), "user data");
  await runCauseEffect(store.updateAgent({ agentId: agent.id, workingDirectory: repository }));
  const reopened = new AgentStore(userData, home);
  await runCauseEffect(reopened.initialize());
  expect(reopened.list().find((item) => item.id === agent.id)?.workingDirectory).toBe(repository);
  reopened.database.connection.exec("DELETE FROM projection_agents");
  const replayed = new AgentStore(userData, home);
  await runCauseEffect(replayed.initialize());
  expect(replayed.list().find((item) => item.id === agent.id)?.workingDirectory).toBe(repository);

  const copy = await runCauseEffect(reopened.duplicateAgent(agent.id));
  expect(copy.workingDirectory).toBeUndefined();
  await runCauseEffect(reopened.deleteAgent(agent.id));
  expect(await readFile(join(repository, "keep.txt"), "utf8")).toBe("user data");
});

it("refuses a missing folder and preserves the previous selection", async () => {
  const started = await startService(root, { provider: "codex", output: "DONE", preferredProvider: "codex" });
  service = started.service;
  await runCauseEffect(started.store.getOrCreate("chief"));
  await expect(runCauseEffect(service.setWorkingDirectory("chief", join(root, "missing")))).rejects.toThrow(
    "unavailable",
  );
  expect(service.listAgents().find((agent) => agent.id === "chief")?.workingDirectory).toBeUndefined();
});

it("refuses a directory change while a turn is pending", async () => {
  const started = await startService(root, { provider: "codex", autoComplete: false, preferredProvider: "codex" });
  service = started.service;
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Keep this turn active." }));
  await waitFor(() => started.client.requests.some((request) => request.method === "turn/start"));
  await expect(runCauseEffect(service.setWorkingDirectory("chief", root))).rejects.toThrow("pending work");
  expect(service.listAgents().find((agent) => agent.id === "chief")?.workingDirectory).toBeUndefined();
});

it("rejects work queued during directory validation", async () => {
  const started = await startService(root, { provider: "codex", autoComplete: false, preferredProvider: "codex" });
  service = started.service;
  await runCauseEffect(started.store.getOrCreate("chief"));
  const change = runCauseEffect(service.setWorkingDirectory("chief", root));
  const rejected = expect(change).rejects.toThrow("pending work");
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Run during validation." }));
  await rejected;
  await waitFor(() => started.client.requests.some((request) => request.method === "turn/start"));
  const agent = service.listAgents().find((agent) => agent.id === "chief");
  expect(agent?.workingDirectory).toBeUndefined();
  const turn = started.client.requests.find((request) => request.method === "turn/start");
  expect(paramsRecord(turn?.params)?.cwd).toBe(agent?.workspacePath);
});

it("does not run in another folder when the selected folder becomes unavailable", async () => {
  const started = await startService(root, { provider: "codex", output: "DONE", preferredProvider: "codex" });
  service = started.service;
  await runCauseEffect(started.store.getOrCreate("chief"));
  const repository = join(root, "repository");
  await mkdir(repository);
  await runCauseEffect(service.setWorkingDirectory("chief", repository));
  const resolved = await realpath(repository);
  await rename(repository, join(root, "moved-repository"));
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Do not use a different folder." }));
  await waitForQueue(service, "chief", (queue) => queue.deliveries.some((item) => item.status === "failed"));
  expect(started.client.requests.some((request) => request.method === "turn/start")).toBe(false);
  expect(service.listAgents().find((agent) => agent.id === "chief")?.workingDirectory).toBe(resolved);
});

it("rolls back the setting and session retirement when storage fails", async () => {
  const started = await startService(root, { provider: "codex", output: "DONE", preferredProvider: "codex" });
  service = started.service;
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Keep this conversation." }));
  await waitFor(() => service !== null && !service.workingDirectoryBusy("chief"));
  const session = started.store.activeProviderSession("chief");
  started.store.database.connection.exec(
    `CREATE TEMP TRIGGER fail_directory_save BEFORE INSERT ON projection_agents BEGIN SELECT RAISE(ABORT, 'test save failure'); END`,
  );
  await expect(runCauseEffect(service.setWorkingDirectory("chief", root))).rejects.toThrow("test save failure");
  expect(service.listAgents().find((agent) => agent.id === "chief")?.workingDirectory).toBeUndefined();
  expect(started.store.activeProviderSession("chief")).toEqual(session);
  started.store.database.connection.exec("DROP TRIGGER fail_directory_save");
  await runCauseEffect(service.setWorkingDirectory("chief", root));
  expect(service.listAgents().find((agent) => agent.id === "chief")?.workingDirectory).toBe(await realpath(root));
});
