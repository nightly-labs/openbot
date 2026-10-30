// Checks the browser profile of each agent through the real profile service, agent service, agent store
// and profile store on a temporary database. The agents move between the shared profile, their own
// session and named profiles; a profile is deleted; then the stores start again from the database, as
// the app does at its next launch. A choice of the shared profile, and the delete of a named profile,
// must leave no profile id on the agent, before and after the restart. The browser is a stub: no tab is
// open, so a profile change closes nothing.
// The agent service is not initialized, so no provider CLI starts.
// Run: `bun scripts/browser-profile-agents-e2e.ts`.
// Writes .openbot-build/browser-profile-agents-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentBrowserProfile } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { BrowserProfileStore } from "../src/backend/browser-profiles/browser-profile-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { type BrowserProfileService, createBrowserProfileService } from "../src/main/browser-profile-service";

const OUT = resolve(import.meta.dirname, "../.openbot-build/browser-profile-agents-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-browser-profile-agents-"));
const userData = join(root, "user-data");
const home = join(root, "home");
mkdirSync(home, { recursive: true });

const report: {
  status: "passed" | "failed";
  checks: { name: string; passed: boolean }[];
  error?: string;
} = { status: "failed", checks: [] };

function pass(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
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
};

interface Host {
  database: OpenBotDatabase;
  store: AgentStore;
  agents: AgentService;
  profiles: BrowserProfileService;
}

/** Starts the stores on the profile, as the app does at each launch. */
async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  await runCauseEffect(store.initialize());
  await runCauseEffect(mailbox.initialize());
  const agents = new AgentService({ store, mailbox, browser: agentBrowser });
  const profiles = createBrowserProfileService({
    store: new BrowserProfileStore(store.database),
    agents,
    browser: {
      tabIdsInSession: () => [],
      listTabSessions: () => [],
      close: () => Effect.void,
      clearTabSession: () => Effect.void,
    },
  });
  return { database, store, agents, profiles };
}

/** The stored fields that choose the session, as the next launch reads them. */
function stored(host: Host, agentId: string) {
  const agent = host.store.list().find((candidate) => candidate.id === agentId);
  assert.ok(agent, "An agent is missing.");
  return { ownBrowserSession: agent.ownBrowserSession, browserProfileId: agent.browserProfileId };
}

const choose = (host: Host, agentId: string, profile: AgentBrowserProfile) =>
  runCauseEffect(host.profiles.updateAgent({ agentId, profile }));

let host: Host | null = null;
try {
  host = await startHost();
  const current = host;
  const create = (name: string) =>
    runCauseEffect(
      current.agents.createAgentProfile({ name, description: name, avatarSeed: name.toLowerCase(), avatarHue: null }),
    );
  const first = await create("First");
  const second = await create("Second");
  const third = await create("Third");
  const clientA = await runCauseEffect(host.profiles.create("Client A"));
  const clientB = await runCauseEffect(host.profiles.create("Client B"));

  await choose(host, first.id, { kind: "profile", profileId: clientA.id });
  await choose(host, second.id, { kind: "profile", profileId: clientA.id });
  await choose(host, third.id, { kind: "profile", profileId: clientB.id });
  pass(
    "two agents share a profile and a third uses another",
    host.profiles.list().profiles.find((profile) => profile.id === clientA.id)?.agentIds.length === 2 &&
      host.profiles.list().profiles.find((profile) => profile.id === clientB.id)?.agentIds.length === 1,
    host.profiles.list().profiles,
  );

  await choose(host, third.id, { kind: "shared" });
  pass(
    "a choice of the shared profile removes the named profile",
    host.profiles.readAgent(third.id).kind === "shared" &&
      stored(host, third.id).browserProfileId === undefined &&
      host.profiles.list().sharedAgentIds.includes(third.id) &&
      !host.profiles.list().sharedAgentIds.includes(first.id),
    stored(host, third.id),
  );

  await choose(host, third.id, { kind: "profile", profileId: clientB.id });
  await runCauseEffect(host.profiles.delete(clientB.id));
  pass(
    "a deleted profile's agent changes to the shared profile",
    host.profiles.readAgent(third.id).kind === "shared" &&
      stored(host, third.id).browserProfileId === undefined &&
      !host.profiles.list().profiles.some((profile) => profile.id === clientB.id),
    stored(host, third.id),
  );

  await choose(host, first.id, { kind: "agent" });
  pass(
    "a choice of the agent's own session removes the named profile",
    host.profiles.readAgent(first.id).kind === "agent" && stored(host, first.id).browserProfileId === undefined,
    stored(host, first.id),
  );

  await runCauseEffect(host.agents.stop());
  host.database.close();
  host = await startHost();
  pass(
    "the choices stay after a restart",
    host.profiles.readAgent(first.id).kind === "agent" &&
      host.profiles.readAgent(third.id).kind === "shared" &&
      stored(host, third.id).browserProfileId === undefined &&
      JSON.stringify(host.profiles.readAgent(second.id)) === JSON.stringify({ kind: "profile", profileId: clientA.id }),
    [stored(host, first.id), stored(host, second.id), stored(host, third.id)],
  );
  report.status = "passed";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (host) {
    await runCauseEffect(host.agents.stop()).catch(() => undefined);
    host.database.close();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length })}\n`);
  if (report.error) process.stderr.write(`${report.error}\n`);
}
