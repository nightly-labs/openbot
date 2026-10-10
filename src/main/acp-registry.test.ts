import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCustomAgentResult } from "@openbot/contracts/ipc";
import { Deferred, Effect } from "effect";
import { afterEach, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { createAcpRegistry } from "./acp-registry";
import type { RegistryAgent } from "./acp-registry-catalog";
import { createCustomAgentChanges } from "./custom-agent-changes";
import { CustomAgentStore } from "./custom-agent-store";
import { ProviderRuntimeFailure } from "./provider-runtime-effects";

// Failure modes: failed/cancelled updates replace a working command; runtime removal deletes
// saved credentials; concurrent settings edits lose secrets; fresh reserved IDs collide; long
// catalog names make the saved agent fail the custom-agent response contract.
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function setup(name = "Example") {
  const folder = await mkdtemp(join(tmpdir(), "openbot-registry-"));
  folders.push(folder);
  const store = new CustomAgentStore({
    path: join(folder, "agents.json"),
    cipher: { canPersist: () => true, encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString() },
    resolve: (command) => Effect.succeed(command),
  });
  const changes = createCustomAgentChanges({
    customAgents: store,
    service: {
      saveCustomAgent: (persist) => persist(),
      removeCustomAgent: (_id, persist) => persist(),
      reloadCustomAgents: () => Effect.succeed("restarted"),
    },
  });
  const entry: RegistryAgent = {
    id: "example",
    name,
    description: "Test",
    version: "1.0.0",
    distribution: { npx: { package: "example@1.0.0" } },
  };
  let fail = false;
  const entered = Deferred.makeUnsafe<void>();
  let suspend = false;
  const registry = createAcpRegistry({
    directory: folder,
    customAgentChanges: changes,
    withRuntimeRemoval: (_ids, operation) => operation,
    catalog: () => Effect.succeed([entry]),
    prepare: (_agent, _distribution, directory) =>
      Effect.gen(function* () {
        if (fail) return yield* new ProviderRuntimeFailure({ cause: new Error("prepare failed") });
        if (suspend) {
          yield* Deferred.succeed(entered, undefined);
          yield* Effect.never;
        }
        return { command: join(directory, "runtime", "agent"), args: [], env: { TOKEN: "initial" } };
      }),
  });
  return {
    folder,
    store,
    changes,
    registry,
    fail: () => {
      fail = true;
    },
    suspend: () => {
      suspend = true;
    },
    recover: () => {
      fail = false;
      suspend = false;
    },
    entered,
  };
}

it("keeps a working command after failed and cancelled updates, and keeps saved secrets on uninstall", async () => {
  const a = await setup();
  const input = { registryId: "example", customAgentId: "example" };
  await runCauseEffect(a.registry.install(input));
  const original = a.store.configs()[0];
  a.suspend();
  const installing = runCauseEffect(a.registry.install(input));
  await Effect.runPromise(Deferred.await(a.entered));
  await Effect.runPromise(a.registry.cancel("example"));
  await expect(installing).rejects.toThrow();
  expect(a.store.configs()[0]).toEqual(original);
  a.fail();
  await expect(runCauseEffect(a.registry.install(input))).rejects.toThrow("prepare failed");
  expect(a.store.configs()[0]).toEqual(original);
  expect(await runCauseEffect(a.registry.listInstalled())).toHaveLength(1);
  await runCauseEffect(a.registry.uninstall("example"));
  expect(a.store.configs()[0]).toEqual(original);
  expect(await runCauseEffect(a.registry.listInstalled())).toEqual([]);
  expect(JSON.parse(await readFile(join(a.folder, "acp-registry", "installed.json"), "utf8"))[0].removed).toBe(true);
  expect((await runCauseEffect(a.registry.search()))[0]?.customAgentId).toBe(input.customAgentId);
  a.recover();
  await runCauseEffect(a.registry.install(input));
  expect(await runCauseEffect(a.registry.listInstalled())).toHaveLength(1);
  expect(a.store.configs()[0]?.env).toEqual(original?.env);
});

it("keeps edits to saved name and credentials during an update and rejects a changed command", async () => {
  const a = await setup();
  await runCauseEffect(a.registry.install({ registryId: "example", customAgentId: "example" }));
  const old = (await Effect.runPromise(a.changes.list()))[0];
  if (!old) throw new Error("Expected installed agent");
  await runCauseEffect(
    a.changes.save({
      id: old.id,
      name: "Edited",
      command: old.command,
      args: old.args,
      env: [{ name: "TOKEN", value: "edited-secret" }],
    }),
  );
  await runCauseEffect(
    a.changes.saveIfUnchanged(
      { id: old.id, name: "Registry", command: "/updated", args: [], env: [{ name: "TOKEN", value: "default" }] },
      old,
    ),
  );
  expect(a.store.configs()[0]).toMatchObject({
    name: "Edited",
    command: "/updated",
    env: [{ name: "TOKEN", value: "edited-secret" }],
  });
  await expect(
    runCauseEffect(
      a.changes.saveIfUnchanged({ id: old.id, name: "Registry", command: "/stale", args: [], env: [] }, old),
    ),
  ).rejects.toThrow();
  expect(a.store.configs()[0]?.command).toBe("/updated");
  await expect(
    runCauseEffect(a.changes.save({ id: "pi", name: "Reserved", command: "/agent", args: [], env: [] })),
  ).rejects.toThrow();
  await runCauseEffect(a.store.save({ id: "pi", name: "Legacy", command: "/agent", args: [], env: [] }));
  await runCauseEffect(a.changes.save({ id: "pi", name: "Existing", command: "/agent", args: [], env: [] }));
  expect(a.store.configs().find((agent) => agent.id === "pi")?.name).toBe("Existing");
});

it("keeps the catalog display name while saving a bounded custom agent name", async () => {
  const name = "Registry display name ".repeat(7);
  const a = await setup(name);
  expect((await runCauseEffect(a.registry.search()))[0]?.name).toBe(name);
  const installed = await runCauseEffect(a.registry.install({ registryId: "example", customAgentId: "example" }));
  expect(installed.agents[0]?.name).toBe(name.trim().slice(0, 80));
  expect(isCustomAgentResult(installed)).toBe(true);
  expect(a.store.configs()[0]?.name).toBe(name.trim().slice(0, 80));
});
