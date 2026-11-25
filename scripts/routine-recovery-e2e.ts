import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { EventRoutine, EventRoutineRun, SaveEventRoutineInput } from "@openbot/contracts/ipc-events";
import { ROUTINE_RECOVERY_CAPABILITY } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-recovery-e2e");

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
  command: "routine-recovery-e2e",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const logger = createOpenBotLogger("routine-recovery-e2e");
const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
  expectedRendererPort: instance.rendererPort,
  ownerPid: instance.pid,
});

function save(page: Page, input: SaveEventRoutineInput, serverId: string): Promise<EventRoutine> {
  return page.evaluate(async ([value, id]) => (await window.openbot.events.saveRoutine(value, id)).routine, [
    input,
    serverId,
  ] as const);
}

function refusal(page: Page, routineId: string, owner: SaveEventRoutineInput["owner"], serverId: string) {
  return page.evaluate(
    async ([id, routineOwner, server]) => {
      try {
        await window.openbot.events.listRoutineRuns({ owner: routineOwner, routineId: id }, server);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [routineId, owner, serverId] as const,
  );
}

mkdirSync(OUT, { recursive: true });
const page = session.page;
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail: unknown = null) => checks.push({ name, passed, detail });
let cleanup: (() => Promise<void>) | null = null;
try {
  const servers = await page.evaluate(() => window.openbot.servers.list());
  const server = servers.find(
    (item) => item.kind === "remote" && item.compatibility?.capabilities.includes(ROUTINE_RECOVERY_CAPABILITY) === true,
  );
  check(
    "the joined host advertises routine-recovery-v1",
    server !== undefined,
    servers.map((item) => ({ kind: item.kind, capabilities: item.compatibility?.capabilities.length ?? null })),
  );
  assert.ok(server, "No joined server advertises routine-recovery-v1. Start the host from this worktree.");
  const serverId = server.id;
  const agents = await page.evaluate((id) => window.openbot.agent.listAgents(id), serverId);
  const agent = agents[0];
  assert.ok(agent, "The joined host has no agent. Add one on the host first.");
  const owner = { kind: "agent", id: agent.id } as const;
  const base = {
    owner,
    name: `Recovery E2E ${Date.now()}`,
    instruction: "Reply with the word done.",
    active: false,
    timezone: "UTC",
    trigger: { kind: "schedule", schedule: { kind: "hourly", minute: 0 } },
  } satisfies SaveEventRoutineInput;

  const created = await save(page, { ...base, limitPolicy: "skip", missedPolicy: "run-once" }, serverId);
  cleanup = () =>
    page.evaluate(([id, routineOwner, s]) => window.openbot.events.deleteRoutine({ id, owner: routineOwner }, s), [
      created.id,
      owner,
      serverId,
    ] as const);
  check("a new routine keeps both policies", created.limitPolicy === "skip" && created.missedPolicy === "run-once", {
    limitPolicy: created.limitPolicy,
    missedPolicy: created.missedPolicy,
  });

  const listed = await page.evaluate(([o, s]) => window.openbot.events.listRoutines({ owner: o }, s), [
    owner,
    serverId,
  ] as const);
  const read = listed.find((routine) => routine.id === created.id);
  check("the routine list reads both policies", read?.limitPolicy === "skip" && read.missedPolicy === "run-once", {
    limitPolicy: read?.limitPolicy,
    missedPolicy: read?.missedPolicy,
  });

  const limitOnly = await save(page, { ...base, id: created.id, limitPolicy: "wait" }, serverId);
  check(
    "a save with only limitPolicy keeps missedPolicy",
    limitOnly.limitPolicy === "wait" && limitOnly.missedPolicy === "run-once",
    { limitPolicy: limitOnly.limitPolicy, missedPolicy: limitOnly.missedPolicy },
  );

  const missedOnly = await save(page, { ...base, id: created.id, missedPolicy: "skip" }, serverId);
  check(
    "a save with only missedPolicy keeps limitPolicy",
    missedOnly.limitPolicy === "wait" && missedOnly.missedPolicy === "skip",
    { limitPolicy: missedOnly.limitPolicy, missedPolicy: missedOnly.missedPolicy },
  );

  const runs: EventRoutineRun[] = await page.evaluate(
    ([o, id, s]) => window.openbot.events.listRoutineRuns({ owner: o, routineId: id, limit: 5 }, s),
    [owner, created.id, serverId] as const,
  );
  check("the run history of a routine that never ran is empty", runs.length === 0, runs);

  await cleanup();
  cleanup = null;
  const afterDelete = await refusal(page, created.id, owner, serverId);
  check("the run history of a deleted routine is refused", afterDelete !== null, afterDelete);
} finally {
  if (cleanup) await cleanup().catch((error: unknown) => logger.error("Could not delete the E2E routine.", { error }));
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ checks }, null, 2)}\n`);
  await session.close();
}
const failed = checks.filter((item) => !item.passed);
for (const item of failed) logger.error(`Failed: ${item.name}.`, { detail: item.detail });
assert.equal(failed.length, 0, `${failed.length} of ${checks.length} routine recovery checks failed.`);
logger.info(`Passed ${checks.length} routine recovery checks. Wrote ${resolve(OUT, "report.json")}.`);
