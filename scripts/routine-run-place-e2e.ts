// Sets where a routine runs, the agent's chat or the routine's own thread, on a joined server through
// `routine-run-place-v1`, from the window of a running dev client. Start the two-client harness with
// `bun run dev:test-client`; the test client joins this worktree's app as an owner. The script makes
// one inactive routine on the host's first agent through the released routine calls that every member
// uses, moves it between the chat and a thread, does the same through the event calls of an owner,
// and deletes the routine. Writes .openbot-build/routine-run-place-e2e/report.json. Needs
// `--allow-mutations`: `bun scripts/routine-run-place-e2e.ts --allow-mutations`.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CreateRoutineInput,
  canAdministerServer,
  type OpenBotDesktopApi,
  type UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import type { SaveEventRoutineInput } from "@openbot/contracts/ipc-events";
import { ROUTINE_RUN_PLACE_CAPABILITY } from "@openbot/contracts/team-protocol/routine-run-place-v1";
import { createOpenBotLogger } from "@openbot/logging";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-run-place-e2e");

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

const instances = readDevInstanceRecords().filter(
  (record) => record.service === "test-client" && resolve(record.projectRoot) === resolve(process.cwd()),
);
assert.equal(instances.length, 1, "Start `bun run dev:test-client` for this worktree first.");
const instance = instances[0];
assert.ok(instance);
assertMutationAllowed({
  command: "routine-run-place-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("routine-run-place-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

mkdirSync(OUT, { recursive: true });
const page = session.page;
const checks: Check[] = [];
const skipped: string[] = [];
const check = (name: string, passed: boolean, detail: unknown = null) => checks.push({ name, passed, detail });
let cleanup: (() => Promise<void>) | null = null;
try {
  const servers = await page.evaluate(() => window.openbot.servers.list());
  const server = servers.find(
    (item) =>
      item.kind === "remote" && item.compatibility?.capabilities.includes(ROUTINE_RUN_PLACE_CAPABILITY) === true,
  );
  check(
    "the joined host advertises routine-run-place-v1",
    server !== undefined,
    servers.map((item) => ({ kind: item.kind, capabilities: item.compatibility?.capabilities.length ?? null })),
  );
  assert.ok(server, "No joined server advertises routine-run-place-v1. Start the host from this worktree.");
  const serverId = server.id;
  const agents = await page.evaluate((id) => window.openbot.agent.listAgents(id), serverId);
  const agent = agents[0];
  assert.ok(agent, "The joined host has no agent. Add one on the host first.");
  const agentId = agent.id;
  const placeOf = async (routineId: string) => {
    const routines = await page.evaluate(([id, s]) => window.openbot.agent.listRoutines(id, s), [
      agentId,
      serverId,
    ] as const);
    return routines.find((routine) => routine.id === routineId)?.runIn;
  };

  // The released routine calls, which every member who manages the agent uses.
  const input = {
    agentId,
    name: `Run place E2E ${Date.now()}`,
    instruction: "Reply with the word done.",
    // Inactive: the routine never runs while the script works.
    active: false,
    timezone: "UTC",
    schedule: { kind: "hourly", minute: 0 },
    runIn: "thread",
  } satisfies CreateRoutineInput;
  const created = await page.evaluate(([value, s]) => window.openbot.agent.createRoutine(value, s), [
    input,
    serverId,
  ] as const);
  const routineId = created.id;
  cleanup = () =>
    page.evaluate(([value, s]) => window.openbot.agent.deleteRoutine(value, s), [
      { agentId, routineId },
      serverId,
    ] as const);
  check("a new routine made with runIn thread runs in its own thread", created.runIn === "thread", created.runIn);
  check("the routine list reads the thread place", (await placeOf(routineId)) === "thread", null);

  const rename = {
    agentId,
    routineId,
    name: `${input.name} renamed`,
    instruction: input.instruction,
    active: false,
    schedule: input.schedule,
  } satisfies UpdateRoutineInput;
  await page.evaluate(([value, s]) => window.openbot.agent.updateRoutine(value, s), [rename, serverId] as const);
  check("an update with no runIn keeps the thread place", (await placeOf(routineId)) === "thread", null);

  const toChat = { ...rename, runIn: "chat" } satisfies UpdateRoutineInput;
  const updated = await page.evaluate(([value, s]) => window.openbot.agent.updateRoutine(value, s), [
    toChat,
    serverId,
  ] as const);
  check(
    "an update with runIn chat moves the routine back to the chat",
    updated.runIn === "chat" && (await placeOf(routineId)) === "chat",
    updated.runIn,
  );

  // The event calls of an owner or admin. The test client joins as a member until a host admin changes
  // its role, so a member run records that it left them out.
  if (!canAdministerServer(server.role)) {
    skipped.push("event calls: the test client is a member of the joined host");
    await cleanup();
    cleanup = null;
  } else {
    const owner = { kind: "agent", id: agentId } as const;
    const event = {
      id: routineId,
      owner,
      name: `${input.name} renamed`,
      instruction: input.instruction,
      active: false,
      timezone: "UTC",
      trigger: { kind: "schedule", schedule: { kind: "hourly", minute: 0 } },
      runIn: "thread",
    } satisfies SaveEventRoutineInput;
    const saved = await page.evaluate(
      async ([value, s]) => (await window.openbot.events.saveRoutine(value, s)).routine,
      [event, serverId] as const,
    );
    const listed = await page.evaluate(([o, s]) => window.openbot.events.listRoutines({ owner: o }, s), [
      owner,
      serverId,
    ] as const);
    check(
      "an event save with runIn thread moves the routine to its thread, and the event list reads it",
      saved.runIn === "thread" && listed.find((routine) => routine.id === routineId)?.runIn === "thread",
      { saved: saved.runIn, listed: listed.find((routine) => routine.id === routineId)?.runIn },
    );
    const { runIn: _eventPlace, ...eventWithoutPlace } = event;
    const eventKept = await page.evaluate(
      async ([value, s]) => (await window.openbot.events.saveRoutine(value, s)).routine,
      [eventWithoutPlace, serverId] as const,
    );
    check(
      "an event save with no runIn keeps the saved place",
      (await placeOf(routineId)) === "thread",
      eventKept.runIn,
    );

    await cleanup();
    cleanup = null;
  }
} finally {
  if (cleanup) await cleanup().catch((error: unknown) => logger.error("Could not delete the E2E routine.", { error }));
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ checks, skipped }, null, 2)}\n`);
  await session.close();
}
const failed = checks.filter((item) => !item.passed);
for (const item of failed) logger.error(`Failed: ${item.name}.`, { detail: item.detail });
assert.equal(failed.length, 0, `${failed.length} of ${checks.length} routine run place checks failed.`);
for (const item of skipped) logger.warn(`Not checked: ${item}.`);
logger.info(`Passed ${checks.length} routine run place checks. Wrote ${resolve(OUT, "report.json")}.`);
