// Checks the `set_browser_profile` tool and the browser profile in `read_agent` of issue #8850, through
// the real profile service, agent service, agent store and profile store on a temporary database.
// A coordinator moves two agents to a new named profile in one call, reuses the profile by a name in
// another case, moves agents to the shared profile and to profiles of their own, and gets a refusal for
// a turn that no person started and for a card that the owner declines. Each call goes through
// `handleSetBrowserProfileTool`, as the tool router sends it, with a card stub that records the text and
// gives the owner's answer. A failed call becomes the correctable tool failure of the router.
// The browser is a stub with no tabs, and the agent service is not initialized, so no provider starts.
// Run: `bun scripts/agent-browser-profile-tool-e2e.ts`.
// Writes .openbot-build/agent-browser-profile-tool-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { agentBrowserProfileView, handleSetBrowserProfileTool } from "../src/backend/agent/browser-profile-tool";
import { profileToolErrorMessage } from "../src/backend/agent/profile-tools";
import { openBotToolFailure } from "../src/backend/agent/routine-tools";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { BrowserProfileStore } from "../src/backend/browser-profiles/browser-profile-store";
import { BrowserProxyStore } from "../src/backend/browser-profiles/browser-proxy-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { createBrowserProfileService } from "../src/main/browser-profile-service";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-browser-profile-tool-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-browser-profile-tool-"));
const userData = join(root, "user-data");
const home = join(root, "home");
mkdirSync(home, { recursive: true });

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

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
let agents: AgentService | null = null;

try {
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const service = new AgentService({ store, mailbox, browser: agentBrowser });
  agents = service;
  const profiles = createBrowserProfileService({
    store: new BrowserProfileStore(store.database),
    proxies: new BrowserProxyStore(store.database),
    // The script saves no proxy password, so the cipher only has to exist.
    cipher: { canPersist: () => true, encrypt: (value) => Buffer.from(value, "utf8") },
    agents: service,
    browser: {
      tabIdsInSession: () => [],
      listTabSessions: () => [],
      close: () => Effect.void,
      proxyFailure: () => null,
      forgetProxyFailure: () => undefined,
      clearTabSession: () => Effect.void,
      releaseProfileProxy: () => Effect.void,
    },
  });
  const create = (name: string) =>
    runCauseEffect(
      service.createAgentProfile({ name, description: name, avatarSeed: name.toLowerCase(), avatarHue: null }),
    );
  const coordinator = await create("Coordinator");
  const sales = await create("Sales");
  const support = await create("Support");

  const cards: string[] = [];
  let answer = "accept";
  /** One `set_browser_profile` call from the coordinator, answered as the tool router answers it. */
  const call = async (args: unknown, requestedByPerson = true): Promise<{ success: boolean; value: DynamicRecord }> => {
    const response = await Effect.runPromise(
      handleSetBrowserProfileTool(
        {
          threadId: "t",
          turnId: "turn",
          callId: "c",
          namespace: "openbot",
          tool: "set_browser_profile",
          arguments: args,
        },
        {
          listAgents: () => service.listAgents(),
          profiles,
          requestedByPerson,
          approve: (reason) =>
            Effect.sync(() => {
              cards.push(reason);
              return answer;
            }),
          redactMcp: (text) => text,
        },
      ).pipe(Effect.catch((failure) => Effect.succeed(openBotToolFailure(profileToolErrorMessage(failure.cause))))),
    );
    const item = response.contentItems[0];
    assert.ok(item && item.type === "inputText", "The answer is text.");
    const parsed = JSON.parse(item.text);
    const value = isDynamicRecord(parsed) ? parsed : { text: item.text };
    return { success: response.success, value };
  };
  const view = (agentId: string) => {
    const agent = service.listAgents().find((candidate) => candidate.id === agentId);
    assert.ok(agent, `Agent ${agentId} exists.`);
    return agentBrowserProfileView(agent, profiles.list().profiles);
  };

  await step("A turn that no person started cannot change a profile, and shows no card", async () => {
    const { success, value } = await call({ agentIds: [sales.id], profile: "named", name: "Client A" }, false);
    assert.equal(success, false);
    assert.equal(cards.length, 0);
    assert.equal(profiles.list().profiles.length, 0, "No profile is made.");
    assert.deepEqual(view(sales.id), { kind: "shared" });
    return value;
  });

  await step("A declined card changes nothing", async () => {
    answer = "decline";
    const { success, value } = await call({ agentIds: [sales.id], profile: "named", name: "Client A" });
    answer = "accept";
    assert.equal(success, true);
    assert.equal(value.status, "declined");
    assert.equal(cards.at(-1), sourceText("status.agent.browserProfileNew", { agents: "Sales", profile: "Client A" }));
    assert.equal(profiles.list().profiles.length, 0, "No profile is made.");
    assert.deepEqual(view(sales.id), { kind: "shared" });
    return value;
  });

  await step("One call makes a named profile and moves two agents to it", async () => {
    const { success, value } = await call({ agentIds: [sales.id, support.id], profile: "named", name: "Client A" });
    assert.equal(success, true);
    assert.equal(value.status, "changed");
    assert.equal(value.created, true);
    assert.equal(value.moved, 2);
    assert.equal(value.failed, 0);
    assert.equal(
      cards.at(-1),
      sourceText("status.agent.browserProfileNew", { agents: "Sales, Support", profile: "Client A" }),
    );
    const named = profiles.list().profiles;
    assert.equal(named.length, 1);
    assert.deepEqual([...(named[0]?.agentIds ?? [])].sort(), [sales.id, support.id].sort());
    assert.deepEqual(view(sales.id), { kind: "named", name: "Client A" });
    assert.deepEqual(view(coordinator.id), { kind: "shared" }, "An agent not in the list keeps its profile.");
    return value;
  });

  await step("A name in another case reuses the profile; agents already on it need no card", async () => {
    const before = cards.length;
    const unchanged = await call({ agentIds: [sales.id], profile: "named", name: "client a" });
    assert.equal(unchanged.value.status, "unchanged");
    assert.deepEqual(unchanged.value.results, [{ agentId: sales.id, ok: true, unchanged: true }]);
    assert.equal(cards.length, before, "No card for no change.");
    const moved = await call({ agentIds: [coordinator.id, sales.id], profile: "named", name: "CLIENT A" });
    assert.equal(moved.value.status, "changed");
    assert.equal(moved.value.created, undefined);
    assert.equal(moved.value.moved, 1, "Only the agent that changes moves.");
    assert.deepEqual(moved.value.results, [
      { agentId: coordinator.id, ok: true },
      { agentId: sales.id, ok: true, unchanged: true },
    ]);
    assert.equal(
      cards.at(-1),
      sourceText("status.agent.browserProfileNamed", { agents: "Coordinator", profile: "Client A" }),
    );
    assert.equal(profiles.list().profiles.length, 1, "No second profile is made.");
    return moved.value;
  });

  await step("shared and own move agents out of the named profile", async () => {
    const shared = await call({ agentIds: [coordinator.id], profile: "shared" });
    assert.equal(shared.value.moved, 1);
    assert.equal(cards.at(-1), sourceText("status.agent.browserProfileShared", { agents: "Coordinator" }));
    assert.deepEqual(view(coordinator.id), { kind: "shared" });
    const own = await call({ agentIds: [support.id], profile: "own" });
    assert.equal(own.value.moved, 1);
    assert.equal(cards.at(-1), sourceText("status.agent.browserProfileOwn", { agents: "Support" }));
    assert.deepEqual(view(support.id), { kind: "own" });
    assert.deepEqual(view(sales.id), { kind: "named", name: "Client A" });
    return { shared: shared.value, own: own.value };
  });

  await step("A named profile called Shared is not the shared profile", async () => {
    const named = await call({ agentIds: [coordinator.id], profile: "named", name: "Shared" });
    assert.equal(named.value.created, true);
    assert.equal(
      cards.at(-1),
      sourceText("status.agent.browserProfileNew", { agents: "Coordinator", profile: "Shared" }),
    );
    assert.deepEqual(view(coordinator.id), { kind: "named", name: "Shared" });
    const back = await call({ agentIds: [coordinator.id], profile: "shared" });
    assert.equal(back.value.moved, 1);
    assert.deepEqual(view(coordinator.id), { kind: "shared" });
    return back.value;
  });

  await step("An unknown agent id fails the call before a card", async () => {
    const before = cards.length;
    const { success, value } = await call({
      agentIds: [sales.id, "missing-agent"],
      profile: "named",
      name: "Client B",
    });
    assert.equal(success, false);
    assert.equal(cards.length, before);
    assert.equal(profiles.list().profiles.length, 2, "No profile is made.");
    return value;
  });

  await step("A repeated agent id and a missing name are correctable argument errors", async () => {
    const repeated = await call({ agentIds: [sales.id, sales.id], profile: "shared" });
    assert.equal(repeated.success, false);
    const before = cards.length;
    const noName = await call({ agentIds: [sales.id], profile: "named" });
    assert.equal(noName.success, false);
    const extraName = await call({ agentIds: [sales.id], profile: "own", name: "Client A" });
    assert.equal(extraName.success, false);
    assert.equal(cards.length, before);
    return { repeated: repeated.value, noName: noName.value, extraName: extraName.value };
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
