import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-steer-e2e");
const STEERED_MESSAGE = "Use the other branch.";
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-late-steer-"));
const home = join(root, "home");

process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.XDG_DATA_HOME = join(home, ".local/share");
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.XDG_STATE_HOME = join(home, ".local/state");
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface LogEntry {
  event: string;
  text?: string;
}

type Order = "read" | "before" | "after";

interface RaceResult {
  order: Order;
  steeringRequests: number;
  promptsWithMessage: number;
  deliveryStatus: string | null;
}

const report: { passed: boolean; races: RaceResult[]; error?: string } = { passed: false, races: [] };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => Promise<T | null | undefined | false>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

async function race(order: Order): Promise<RaceResult> {
  const folder = join(root, order);
  const executable = join(folder, "bin", "opencode");
  const log = join(folder, "agent.jsonl");
  const fakeAgent = resolve(import.meta.dirname, "provider-fakes/agents/opencode-steer.ts");
  mkdirSync(join(folder, "bin"), { recursive: true });
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo 2.3.0; exit 0; fi',
      `export FAKE_LOG=${JSON.stringify(log)}`,
      `export FAKE_IDLE_STEER=${order === "read" ? "" : order}`,
      `exec "${process.execPath}" "${fakeAgent}" "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(executable, 0o755);
  process.env.OPENBOT_OPENCODE_PATH = executable;

  const database = new OpenBotDatabase(join(folder, "user-data"));
  const store = new AgentStore(join(folder, "user-data"), home, database);
  const mailbox = new MailboxStore(join(folder, "user-data"), store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    requestTimeoutMs: 5_000,
    preferredProvider: "opencode",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "opencode"),
    busyMessageMode: () => "steer",
  });
  const entries = () => readJsonl<LogEntry>(log);
  const idle = (agentId: string) =>
    !agents
      .listQueue(agentId)
      .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
  try {
    await runCauseEffect(agents.initialize());
    const agent = await runCauseEffect(
      agents.createAgent({
        name: `Late steer ${order}`,
        description: "Checks a message that reaches an OpenCode turn as the turn ends.",
        avatarSeed: `late-steer-${order}`,
        avatarHue: null,
        initialMessage: "work",
      }),
    );
    await waitFor("the long turn to start", async () =>
      (await entries()).some((entry) => entry.event === "prompt" && /(^|>)work$/u.test(entry.text ?? "")),
    );
    const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: STEERED_MESSAGE }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, "The message has a delivery.");
    await waitFor("the steer request", async () => (await entries()).some((entry) => entry.event === "steering"));
    await waitFor("the message to finish", async () => {
      const delivery = agents.listQueue(agent.id).deliveries.find((item) => item.id === deliveryId);
      return idle(agent.id) && (delivery === undefined || ["completed", "failed"].includes(delivery.status));
    });
    const delivery = mailbox.getDelivery(deliveryId)?.delivery ?? null;
    const logged = await entries();
    return {
      order,
      steeringRequests: logged.filter((entry) => entry.event === "steering").length,
      promptsWithMessage: logged.filter(
        (entry) => entry.event === "prompt" && (entry.text ?? "").includes(STEERED_MESSAGE),
      ).length,
      deliveryStatus: delivery?.status ?? null,
    };
  } finally {
    await runCauseEffect(agents.stop()).catch(() => {});
    database.close();
  }
}

try {
  for (const order of ["read", "before", "after"] as const) {
    const result = await race(order);
    report.races.push(result);
    assert.equal(result.steeringRequests, 1, `${order}: OpenBot steers the message one time.`);
    assert.equal(
      result.promptsWithMessage,
      order === "read" ? 0 : 1,
      order === "read"
        ? "read: a steer that the running turn read does not run again."
        : `${order}: the message that the ending turn did not read runs one time in the next turn.`,
    );
    assert.equal(result.deliveryStatus, "completed", `${order}: the message's delivery completes.`);
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "late-steer-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
