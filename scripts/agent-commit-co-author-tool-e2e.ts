import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OPENBOT_COMMIT_TRAILER } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { ToolApprovalDecision } from "../src/backend/agent/attention-registry";
import { handleSetCommitCoAuthorTool } from "../src/backend/agent/commit-co-author-tool";
import { developerInstructions } from "../src/backend/agent/developer-instructions";
import { PROFILE_TOOL_NAMES, profileToolErrorMessage } from "../src/backend/agent/profile-tools";
import { openBotToolFailure } from "../src/backend/agent/routine-tools";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { OPENBOT_TOOL_DEFINITIONS } from "../src/backend/openbot-tools";
import { createAgentDefaultsPreferenceStore } from "../src/main/agent-defaults-preference-store";
import { createAgentDefaultsSettings } from "../src/main/agent-defaults-settings";
import { BusyMessageModePreferenceStore } from "../src/main/busy-message-mode-preference-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-commit-co-author-tool-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-commit-co-author-tool-"));
const userData = join(root, "user-data");
const home = join(root, "home");
mkdirSync(home, { recursive: true });
mkdirSync(userData, { recursive: true });

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; steps: Step[] } = { passed: false, steps: [] };

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
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

const defaultsPath = join(userData, "openbot-agent-defaults-v1.json");
const agentDefaults = createAgentDefaultsPreferenceStore(defaultsPath);
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database, () => agentDefaults.get());
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
let agents: AgentService | null = null;

try {
  await runCauseEffect(agentDefaults.load());
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const service = new AgentService({ store, mailbox, browser: agentBrowser });
  agents = service;
  const settings = createAgentDefaultsSettings({
    agents: service,
    agentDefaults,
    busyMessageMode: new BusyMessageModePreferenceStore(join(userData, "busy-message-mode.json")),
  });
  const agent = await runCauseEffect(
    service.createAgentProfile({ name: "Coder", description: "Coder", avatarSeed: "coder", avatarHue: null }),
  );

  const cards: string[] = [];
  let answer: ToolApprovalDecision = "accept";
  const call = async (args: unknown, requestedByPerson = true): Promise<{ success: boolean; value: DynamicRecord }> => {
    const response = await Effect.runPromise(
      handleSetCommitCoAuthorTool(
        {
          threadId: "t",
          turnId: "turn",
          callId: "c",
          namespace: "openbot",
          tool: "set_commit_co_author",
          arguments: args,
        },
        {
          current: () => store.agentDefaults().commitCoAuthor,
          set: (enabled) => settings.update({ commitCoAuthor: enabled }),
          requestedByPerson,
          approve: (reason) =>
            Effect.sync(() => {
              cards.push(reason);
              return answer;
            }),
        },
      ).pipe(Effect.catch((failure) => Effect.succeed(openBotToolFailure(profileToolErrorMessage(failure.cause))))),
    );
    const item = response.contentItems[0];
    assert.ok(item && item.type === "inputText", "The answer is text.");
    const parsed = JSON.parse(item.text);
    const value = isDynamicRecord(parsed) ? parsed : { text: item.text };
    return { success: response.success, value };
  };
  const prompt = () => developerInstructions(agent, store.sharedRoot, [], store.automationRoot, store.agentDefaults());
  const saved = () => {
    const parsed = JSON.parse(readFileSync(defaultsPath, "utf8"));
    assert.ok(isDynamicRecord(parsed), "The preference file holds an object.");
    return parsed.commitCoAuthor;
  };

  await step("Agents get the tool, and the prompt names it while the trailer is on", async () => {
    assert.ok(OPENBOT_TOOL_DEFINITIONS.some((tool) => tool.name === "set_commit_co_author"));
    assert.ok(PROFILE_TOOL_NAMES.has("set_commit_co_author"), "A failure goes back to the agent to correct.");
    assert.equal(store.agentDefaults().commitCoAuthor, true, "The trailer is on by default.");
    const text = prompt();
    assert.ok(text.includes(OPENBOT_COMMIT_TRAILER));
    assert.ok(text.includes("openbot.set_commit_co_author"));
    assert.ok(text.includes(`trailer once: ${OPENBOT_COMMIT_TRAILER}\n`), "No period follows the trailer.");
    return { commitCoAuthor: true };
  });

  await step("A turn that no person started cannot change the setting, and shows no card", async () => {
    const { success, value } = await call({ enabled: false }, false);
    assert.equal(success, false);
    assert.equal(cards.length, 0);
    assert.equal(store.agentDefaults().commitCoAuthor, true);
    return value;
  });

  await step("A declined card and a card that nobody answers change nothing", async () => {
    answer = "decline";
    const declined = await call({ enabled: false });
    answer = "cancel";
    const cancelled = await call({ enabled: false });
    answer = "accept";
    assert.equal(declined.value.status, "declined");
    assert.equal(cancelled.value.status, "cancelled");
    assert.deepEqual(cards, [
      sourceText("status.agent.commitCoAuthorOff"),
      sourceText("status.agent.commitCoAuthorOff"),
    ]);
    assert.equal(store.agentDefaults().commitCoAuthor, true);
    return { declined: declined.value, cancelled: cancelled.value };
  });

  await step("An approved card turns the trailer off for every agent and saves it", async () => {
    const { success, value } = await call({ enabled: false });
    assert.equal(success, true);
    assert.equal(value.status, "changed");
    assert.equal(value.enabled, false);
    assert.equal(store.agentDefaults().commitCoAuthor, false);
    assert.equal(saved(), false, "The preference file keeps the change.");
    assert.ok(!prompt().includes(OPENBOT_COMMIT_TRAILER), "The prompt no longer asks for the trailer.");
    return value;
  });

  await step("Turning it off again changes nothing and shows no card", async () => {
    const before = cards.length;
    const { success, value } = await call({ enabled: false });
    assert.equal(success, true);
    assert.equal(value.status, "unchanged");
    assert.equal(cards.length, before);
    return value;
  });

  await step("The setting stays off after a restart", async () => {
    const reloaded = createAgentDefaultsPreferenceStore(defaultsPath);
    await runCauseEffect(reloaded.load());
    assert.equal(reloaded.get().commitCoAuthor, false);
    return { commitCoAuthor: reloaded.get().commitCoAuthor };
  });

  await step("An approved card turns the trailer on again", async () => {
    const { success, value } = await call({ enabled: true });
    assert.equal(success, true);
    assert.equal(value.status, "changed");
    assert.equal(cards.at(-1), sourceText("status.agent.commitCoAuthorOn"));
    assert.equal(saved(), true);
    assert.ok(prompt().includes(OPENBOT_COMMIT_TRAILER));
    return value;
  });

  await step("A wrong argument is a correctable error and shows no card", async () => {
    const before = cards.length;
    const missing = await call({});
    const extra = await call({ enabled: false, agentId: agent.id });
    assert.equal(missing.success, false);
    assert.equal(extra.success, false);
    assert.equal(cards.length, before);
    assert.equal(store.agentDefaults().commitCoAuthor, true);
    return { missing: missing.value, extra: extra.value };
  });
  report.passed = true;
} catch (error) {
  process.exitCode = 1;
  if (!report.steps.some((entry) => !entry.passed))
    report.steps.push({ name: "setup", passed: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ passed: report.passed, steps: report.steps.length })}\n`);
}
