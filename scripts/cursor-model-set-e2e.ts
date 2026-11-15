// Runs turns on the real Cursor driver against a fake `cursor-agent acp` whose model belongs to the
// process, as Cursor 2026.10.22-27dcf5f's does. Each Cursor model set asks Cursor's server for the
// model list, and a failed request reports "Invalid model value" (#3800). Checks that a turn on the
// model the process already runs on sends no model set, that each turn still runs on its own model
// after another thread changed it, that a set is sent again after a set failed, and that two sets
// that overlap leave the model unknown, because they can apply in another order than they answer.
// `bun run test:cursor-model-set`. Writes .openbot-build/cursor-model-set-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients, type TurnResult } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cursor-model-set-e2e");
const MEDIUM = "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]";
const HIGH = "gpt-5.6-sol[context=272k,reasoning=high,fast=false]";

interface SetEntry {
  method: string;
  value: string;
  failed?: boolean;
}

interface Step {
  name: string;
  sets: SetEntry[];
  turn?: TurnResult;
}

interface Report {
  passed: boolean;
  steps: Step[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-cursor-model-set-e2e-"));
const report: Report = { passed: false, steps: [] };
const clients: AgentClient[] = [];

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const log = join(root, "sets.jsonl");
  const failFlag = join(root, "fail-next-set");
  const reorderFlag = join(root, "reorder-sets");
  const executable = join(root, "cursor", "cursor-agent");
  await installFakeAgent(executable, "cursor-model-set", {
    FAKE_LOG: log,
    FAKE_FAIL_NEXT_SET: failFlag,
    FAKE_REORDER_SETS: reorderFlag,
  });
  const cli: AgentCliInfo = { executable, version: "2026.10.22-27dcf5f", source: "managed" };
  const client = requireProviderDriver("cursor").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();

  let seen = 0;
  const step = async (name: string, action: () => Promise<TurnResult | undefined>): Promise<Step> => {
    const turn = await action();
    const all = await readJsonl<SetEntry>(log);
    const result: Step = { name, sets: all.slice(seen), ...(turn ? { turn } : {}) };
    seen = all.length;
    report.steps.push(result);
    return result;
  };
  const values = (entry: Step) => entry.sets.map((set) => set.value);

  let first = "";
  const open = await step("open thread 1 on medium", async () => {
    first = await startThread(client, { cwd: workspace, model: MEDIUM });
    return undefined;
  });
  assert.deepEqual(values(open), [MEDIUM], "The first thread sets its model one time.");

  for (const name of ["turn 1 on medium", "turn 2 on medium"]) {
    const same = await step(name, () => runTurn(client, first, { model: MEDIUM, text: "ping" }));
    assert.deepEqual(values(same), [], "A turn on the model the process runs on sends no model set.");
    assert.equal(same.turn?.reply, `Model: ${MEDIUM}`, "The turn runs on its model.");
    assert.equal(same.turn?.status, "completed", "The turn completes.");
  }

  let second = "";
  const other = await step("open thread 2 on high", async () => {
    second = await startThread(client, { cwd: workspace, model: HIGH });
    return undefined;
  });
  assert.deepEqual(values(other), [HIGH], "A thread on another model sets it.");

  const back = await step("turn on thread 1 after thread 2", () =>
    runTurn(client, first, { model: MEDIUM, text: "ping" }),
  );
  assert.deepEqual(values(back), [MEDIUM], "A turn after another thread changed the model sets its own again.");
  assert.equal(back.turn?.reply, `Model: ${MEDIUM}`, "The turn runs on its own model.");

  await writeFile(failFlag, "");
  const failed = await step("turn on thread 2 with a failed set", () =>
    runTurn(client, second, { model: HIGH, text: "ping" }).catch((error: unknown) => ({
      reply: "",
      error: error instanceof Error ? error.message : String(error),
      status: null,
    })),
  );
  assert.deepEqual(
    failed.sets.map((set) => set.failed === true),
    [true],
    "The model set of this turn fails.",
  );
  assert.match(failed.turn?.error ?? "", /Invalid model value/, "The turn reports the failure.");

  const retried = await step("turn on thread 2 after the failed set", () =>
    runTurn(client, second, { model: HIGH, text: "ping" }),
  );
  assert.deepEqual(values(retried), [HIGH], "After a failed set, the next turn sends the set again.");
  assert.equal(retried.turn?.reply, `Model: ${HIGH}`, "The turn runs on its model.");
  assert.equal(retried.turn?.status, "completed", "The turn completes.");

  // Thread 1's set applies first and answers last. A record of the last answer would name MEDIUM
  // while the process runs on HIGH, and thread 1's next turn would run on HIGH.
  await writeFile(reorderFlag, "");
  const overlap = await step("overlapping turns on thread 1 and thread 2", async () => {
    const first1 = runTurn(client, first, { model: MEDIUM, text: "ping" });
    // Thread 2's set goes out while thread 1's set waits for its answer.
    await new Promise<void>((resolveWait) => {
      const poll = setInterval(async () => {
        if ((await readJsonl<SetEntry>(log)).length > seen) {
          clearInterval(poll);
          resolveWait();
        }
      }, 10);
    });
    const second2 = runTurn(client, second, { model: HIGH, text: "ping" });
    await Promise.all([first1, second2]);
    return undefined;
  });
  assert.deepEqual(values(overlap), [MEDIUM, HIGH], "Both turns set their model.");
  await rm(reorderFlag);
  const afterOverlap = await step("turn on thread 1 after the overlap", () =>
    runTurn(client, first, { model: MEDIUM, text: "ping" }),
  );
  assert.deepEqual(values(afterOverlap), [MEDIUM], "After overlapping sets, the next turn sends its set.");
  assert.equal(afterOverlap.turn?.reply, `Model: ${MEDIUM}`, "The turn runs on its own model.");

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
