// Sends signed test events to a webhook routine, from the windows of the running dev apps. Start the
// two-client harness with `bun run dev:test-client`: the host app answers through the `events` IPC
// group, and the test client, which joins it as an owner, through `webhook-tests-v1`. On each, the
// script makes one webhook routine on the host's first agent, sends a test event while it is paused
// and again while it is active, reads the activity, refuses a test for a schedule routine, and deletes
// the routines. The active test starts one run of the agent. Writes
// .openbot-build/webhook-test-event-e2e/report.json. Needs `--allow-mutations`:
// `bun scripts/webhook-test-event-e2e.ts --allow-mutations`.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { EventRoutineOwner, SaveEventRoutineInput } from "@openbot/contracts/ipc-events";
import { WEBHOOK_TESTS_CAPABILITY } from "@openbot/contracts/team-protocol/webhook-tests-v1";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

// The page functions below run in the app window, where the preload bridge sets this.
declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/webhook-test-event-e2e");

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

function worktreeInstance(service: DevInstanceRecord["service"]): DevInstanceRecord {
  const records = readDevInstanceRecords().filter(
    (record) => record.service === service && resolve(record.projectRoot) === resolve(process.cwd()),
  );
  assert.equal(records.length, 1, "Start `bun run dev:test-client` for this worktree first.");
  const record = records[0];
  assert.ok(record);
  assertMutationAllowed({
    command: "webhook-test-event-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: true,
    target: record.instanceId,
  });
  return record;
}

const logger = createOpenBotLogger("webhook-test-event-e2e");
const checks: Check[] = [];
const check = (name: string, passed: boolean, detail: unknown = null) => checks.push({ name, passed, detail });

/** The error message of a test event that must fail, or `null` when it succeeded. */
function refusal(page: Page, id: string, owner: EventRoutineOwner, serverId: string) {
  return page.evaluate(
    async ([routineId, routineOwner, server]) => {
      try {
        await window.openbot.events.sendTestEvent({ id: routineId, owner: routineOwner }, server);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [id, owner, serverId] as const,
  );
}

async function runChecks(page: Page, serverId: string, label: string): Promise<void> {
  const agents = await page.evaluate((id) => window.openbot.agent.listAgents(id), serverId);
  const agent = agents[0];
  assert.ok(agent, `The ${label} host has no agent. Add one on the host first.`);
  const owner = { kind: "agent", id: agent.id } as const;
  const base = {
    owner,
    name: `Webhook test E2E ${Date.now()}`,
    instruction: "Reply with the word done.",
    active: false,
    timezone: "UTC",
    trigger: { kind: "webhook", eventType: "e2e.order.paid", filters: [{ pointer: "/order/status", value: "paid" }] },
  } satisfies SaveEventRoutineInput;
  const created: string[] = [];
  const save = (input: SaveEventRoutineInput) =>
    page.evaluate(async ([value, id]) => window.openbot.events.saveRoutine(value, id), [input, serverId] as const);
  const send = (id: string) =>
    page.evaluate(
      async ([routineId, routineOwner, server]) =>
        window.openbot.events.sendTestEvent({ id: routineId, owner: routineOwner }, server),
      [id, owner, serverId] as const,
    );
  try {
    const saved = await save(base);
    created.push(saved.routine.id);
    check(`${label}: a new webhook routine has a secret`, saved.secret !== null, { secret: saved.secret !== null });

    // Paused: the receipt is written, and no run starts.
    const paused = await send(saved.routine.id);
    check(
      `${label}: a paused routine ignores the test event`,
      paused.status === "ignored" && paused.reason === "inactive" && paused.runId === null,
      paused,
    );

    // Active: the event matches the type and the filter, so a run starts.
    await save({ ...base, id: saved.routine.id, active: true });
    const active = await send(saved.routine.id);
    check(
      `${label}: an active routine starts a run for the test event`,
      active.status === "started" &&
        active.reason === null &&
        active.runId !== null &&
        active.eventType === base.trigger.eventType,
      active,
    );

    const activity = await page.evaluate(
      ([routineId, routineOwner, server]) =>
        window.openbot.events.listActivity({ owner: routineOwner, routineId }, server),
      [saved.routine.id, owner, serverId] as const,
    );
    const tests = activity.filter((receipt) => receipt.deliveryId.startsWith("openbot-test-"));
    check(
      `${label}: the activity has both test receipts`,
      tests.length === 2 &&
        tests.some((receipt) => receipt.status === "ignored" && receipt.reason === "inactive") &&
        tests.some((receipt) => receipt.status === "started" && receipt.runId === active.runId),
      tests,
    );

    const schedule = await save({ ...base, trigger: { kind: "schedule", schedule: { kind: "hourly", minute: 0 } } });
    created.push(schedule.routine.id);
    const refused = await refusal(page, schedule.routine.id, owner, serverId);
    check(`${label}: a schedule routine refuses a test event`, refused !== null, refused);
  } finally {
    for (const id of created) {
      await page
        .evaluate(
          ([routineId, routineOwner, server]) =>
            window.openbot.events.deleteRoutine({ id: routineId, owner: routineOwner }, server),
          [id, owner, serverId] as const,
        )
        .catch((error: unknown) => logger.error("Could not delete an E2E routine.", { error }));
    }
  }
}

mkdirSync(OUT, { recursive: true });
try {
  const host = worktreeInstance("app");
  const hostSession = await connectToDevApp(host.remoteDebuggingPort, logger, {
    expectedRendererPort: host.rendererPort,
    ownerPid: host.pid,
  });
  try {
    const servers = await hostSession.page.evaluate(() => window.openbot.servers.list());
    const local = servers.find((item) => item.kind === "local");
    assert.ok(local, "The host app has no local server.");
    await runChecks(hostSession.page, local.id, "local IPC");
  } finally {
    await hostSession.close();
  }

  const client = worktreeInstance("test-client");
  const clientSession = await connectToDevApp(client.remoteDebuggingPort, logger, {
    expectedRendererPort: client.rendererPort,
    ownerPid: client.pid,
  });
  try {
    const servers = await clientSession.page.evaluate(() => window.openbot.servers.list());
    const remote = servers.find(
      (item) => item.kind === "remote" && item.compatibility?.capabilities.includes(WEBHOOK_TESTS_CAPABILITY) === true,
    );
    check(
      "the joined host advertises webhook-tests-v1",
      remote !== undefined,
      servers.map((item) => ({ kind: item.kind, capabilities: item.compatibility?.capabilities.length ?? null })),
    );
    assert.ok(remote, "No joined server advertises webhook-tests-v1. Start the host from this worktree.");
    await runChecks(clientSession.page, remote.id, "Team API");
  } finally {
    await clientSession.close();
  }
} finally {
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify({ checks }, null, 2)}\n`);
}
const failed = checks.filter((item) => !item.passed);
for (const item of failed) logger.error(`Failed: ${item.name}.`, { detail: item.detail });
assert.equal(failed.length, 0, `${failed.length} of ${checks.length} webhook test event checks failed.`);
logger.info(`Passed ${checks.length} webhook test event checks. Wrote ${resolve(OUT, "report.json")}.`);
