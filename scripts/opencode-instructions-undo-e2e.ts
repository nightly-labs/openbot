import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE, AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-instructions-undo");
const START_TEXT = "# Rules\n- Docs: see docs/old-place.md\n";
const OUTSIDE_EDIT = "# Rules\n- Docs: see docs/new-place.md\n- Routines: the user's sentence\n";
const AGENT_FIRST = "# Rules\n- Docs: see docs/old-place.md\n- Agent rule\n";
const AGENT_SECOND = "# Rules\n- Docs: see docs/old-place.md\n- Agent rule\n- Second agent rule\n";
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-instructions-undo-"));
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

type Approvals = "ask-first" | "automatic";

interface Scenario {
  name: string;
  approvals: Approvals;
  outsideEdit: string | null;
  expectedBefore: string;
}

interface ScenarioResult {
  name: string;
  approvals: Approvals;
  permissionsAccepted: number;
  approvalCards: number;
  before: string | null;
  after: string | null;
  fileAfterTurn: string;
  fileAfterUndo: string | null;
}

const SCENARIOS: Scenario[] = [
  { name: "outside edit, ask first", approvals: "ask-first", outsideEdit: OUTSIDE_EDIT, expectedBefore: OUTSIDE_EDIT },
  { name: "outside edit, automatic", approvals: "automatic", outsideEdit: OUTSIDE_EDIT, expectedBefore: OUTSIDE_EDIT },
  { name: "no outside edit", approvals: "automatic", outsideEdit: null, expectedBefore: START_TEXT },
];

const report: { passed: boolean; scenarios: ScenarioResult[]; error?: string } = { passed: false, scenarios: [] };

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

async function run(scenario: Scenario, index: number): Promise<ScenarioResult> {
  const folder = join(root, `scenario-${index}`);
  const executable = join(folder, "bin", "opencode");
  const log = join(folder, "agent.jsonl");
  const fakeAgent = resolve(import.meta.dirname, "provider-fakes/agents/opencode-instructions-write.ts");
  const plan = join(folder, "plan.json");
  mkdirSync(join(folder, "bin"), { recursive: true });
  await writeFile(plan, JSON.stringify({ outsideEdit: scenario.outsideEdit, writes: [AGENT_FIRST, AGENT_SECOND] }));
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo 2.3.0; exit 0; fi',
      `export FAKE_LOG=${JSON.stringify(log)}`,
      `export FAKE_PLAN=${JSON.stringify(plan)}`,
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
    approvalAutomation: {
      autoApproves: () => scenario.approvals === "automatic",
      set: () => Effect.succeed({ defaultAutoApprove: scenario.approvals === "automatic", autoApproveOverrides: {} }),
    },
  });
  let approvalCards = 0;
  agents.on("event", (event) => {
    if (event.type !== "approval") return;
    approvalCards += 1;
    void runCauseEffect(agents.respondToApproval({ requestId: event.approval.requestId, decision: "accept" }));
  });
  const idle = (agentId: string) =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));
  try {
    await runCauseEffect(agents.initialize());
    const agent = await runCauseEffect(
      agents.createAgent({
        name: `Instructions undo ${index}`,
        description: "Checks the Undo text after an agent writes its instruction file.",
        avatarSeed: `instructions-undo-${index}`,
        avatarHue: null,
        initialMessage: "hello",
      }),
    );
    await waitFor("the first turn to end", async () => idle(agent.id));
    const file = join(agent.workspacePath, "AGENTS.md");
    await writeFile(file, START_TEXT);
    await runCauseEffect(agents.sendMessage({ agentId: agent.id, text: "rewrite" }));
    const change = await waitFor("the instructions change marker", async () => {
      if (!idle(agent.id)) return null;
      const snapshot = await runCauseEffect(agents.readConversation(agent.id));
      return snapshot.messages.find((message) => message.itemType === AGENT_INSTRUCTIONS_CHANGE_ITEM_TYPE) ?? null;
    });
    const fileAfterTurn = await readFile(file, "utf8");
    const before = change.instructionsChange?.before ?? null;
    const after = change.instructionsChange?.after ?? null;
    let fileAfterUndo: string | null = null;
    if (before !== null && after !== null) {
      const { createAgentInstructionsFiles } = await import("../src/main/agent-instructions-files");
      const files = createAgentInstructionsFiles(agents);
      await files.save({ agentId: agent.id, text: before, expected: after });
      fileAfterUndo = await readFile(file, "utf8");
    }
    const entries = await readJsonl<{ event: string; accepted?: boolean }>(log);
    return {
      name: scenario.name,
      approvals: scenario.approvals,
      permissionsAccepted: entries.filter((entry) => entry.event === "permission" && entry.accepted).length,
      approvalCards,
      before,
      after,
      fileAfterTurn,
      fileAfterUndo,
    };
  } finally {
    await runCauseEffect(agents.stop()).catch(() => {});
    database.close();
  }
}

try {
  for (const [index, scenario] of SCENARIOS.entries()) {
    const result = await run(scenario, index + 1);
    report.scenarios.push(result);
    assert.equal(result.permissionsAccepted, 2, `${scenario.name}: OpenBot accepts both writes.`);
    assert.equal(
      result.approvalCards,
      scenario.approvals === "ask-first" ? 2 : 0,
      `${scenario.name}: the approval cards follow the agent's approval setting.`,
    );
    assert.equal(result.fileAfterTurn, AGENT_SECOND, `${scenario.name}: the agent's last write is on disk.`);
    assert.equal(result.after, AGENT_SECOND, `${scenario.name}: the marker shows the agent's last text.`);
    assert.equal(result.before, scenario.expectedBefore, `${scenario.name}: Undo brings back the newest user text.`);
    assert.equal(result.fileAfterUndo, scenario.expectedBefore, `${scenario.name}: Undo writes that text.`);
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
