// Offline real-store/process check. Run only against this inactive isolated seed profile:
// bun scripts/spreadsheet-phonetic-fixture-safety-e2e.ts --instance=<worktree-id> --allow-mutations
// Fixture-only --fixture-interrupt=after-pause|after-resume|after-delete exits 86 after the store
// commit and before journal completion. A normal cleanup must recover without edits.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { AgentSummary, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect, Exit, Scope } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { MailboxSync } from "../src/backend/agent/mailbox-sync";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { ChannelStore } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import type { OwnedRoutineRecord } from "../src/backend/routine-store";
import { RoutineTimer } from "../src/backend/routine-timer";
import { WebhookRouteStore } from "../src/backend/webhook-route-store";
import { MANAGED_SKILL_FOLDERS, ManagedSkillService, OWNERSHIP_MARKER } from "../src/main/managed-skill-service";
import { assertMutationAllowed } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import {
  DEVELOPMENT_SEED_MANIFEST_FILE,
  isDevelopmentProfileActive,
  SEED_FALLBACK_AGENT,
  seedDevelopmentState,
} from "./seed-dev-state";
import {
  BUILTIN_SKILL_SLUGS,
  digest,
  FIXTURE_NAME,
  INSTANCE,
  journalPath,
  profile,
  ROOT,
  requireSeedProfile,
} from "./spreadsheet-phonetic-fixture";

const artifact = resolve(ROOT, ".openbot-build/spreadsheet-phonetic-fixture-safety-e2e/report.json");
const report: {
  passed: boolean;
  cases: string[];
  commands: { argv: string[]; exitCode: number | null }[];
  failure: string | null;
} = { passed: false, cases: [], commands: [], failure: null };
let stage = "Validate named isolated inactive seed profile";

function command(
  action: "prepare" | "cleanup",
  expected: number,
  fault?:
    | "after-pause"
    | "after-resume"
    | "after-delete"
    | "after-create"
    | "after-thread"
    | "after-attachment"
    | "after-message"
    | "after-workspace-remove",
) {
  const argv = [
    process.execPath,
    resolve(import.meta.dirname, "spreadsheet-phonetic-fixture.ts"),
    action,
    "--phase=before",
    `--instance=${INSTANCE}`,
    "--allow-mutations",
    ...(fault ? [`--fixture-interrupt=${fault}`] : []),
  ];
  // Never export store errors or child output. No app, CDP, provider, or listener is started.
  const child = spawnSync(argv[0] ?? process.execPath, argv.slice(1), { stdio: "ignore", timeout: 30_000 });
  report.commands.push({ argv, exitCode: child.status });
  assert.equal(child.error, undefined, "Fixture process could not finish.");
  assert.equal(child.signal, null, "Fixture process did not exit normally.");
  assert.equal(child.status, expected, "Unexpected fixture exit code.");
}

async function snapshot() {
  const agents = new AgentStore(profile, homedir());
  await runCauseEffect(agents.initialize());
  try {
    const agentRoutines = new AgentRoutineStore(agents.database);
    const channelRoutines = new ChannelRoutineStore(agents.database);
    const channels = new ChannelStore(agents.database);
    return {
      agents: agents.list(),
      mailboxHash: createHash("sha256").update(JSON.stringify(agents.database.readMailboxState())).digest("hex"),
      conversationsHash: createHash("sha256")
        .update(
          JSON.stringify(agents.list().map((agent) => agents.database.readConversation(agent.id, agent.threadId))),
        )
        .digest("hex"),
      routines: [
        ...agents.list().flatMap((agent) => agentRoutines.listRecords(agent.id)),
        ...channels.list("local").flatMap((channel) => channelRoutines.listRecords(channel.id)),
      ].sort((a, b) => a.id.localeCompare(b.id)),
    };
  } finally {
    agents.database.close();
  }
}

// Use the app's actual reconciliation and stores. Do not initialize a provider or start a timer.
async function hydrateMessages(fixture: AgentSummary) {
  const agents = new AgentStore(profile, homedir());
  await runCauseEffect(agents.initialize());
  const scope = Effect.runSync(Scope.make());
  const unexpected = () => assert.fail("Hydration must not emit events or start work.");
  try {
    assert.deepEqual(
      agents.list().find((agent) => agent.id === fixture.id),
      fixture,
    );
    const mailbox = new MailboxStore(profile, agents.sharedRoot, agents.database);
    await runCauseEffect(mailbox.initialize());
    const conversation = new ConversationRuntime(agents, unexpected, () => agents.list());
    const records = new AgentRoutineStore(agents.database);
    const waits = new AgentWaits({
      store: new AgentWaitStore({ database: agents.database }),
      mailbox,
      hooks: {
        emit: unexpected,
        ownsRoutine: (agentId, routineId) => records.getRecord(agentId, routineId) !== null,
        hasRoutine: (agentId) => records.listRecords(agentId).length > 0,
      },
    });
    const timer: RoutineTimer = new RoutineTimer(
      () => [routines],
      () => false,
      unexpected,
    );
    const routines: RoutineScheduler = new RoutineScheduler({
      store: agents,
      mailbox,
      conversation,
      waits,
      timer,
      hooks: {
        emit: unexpected,
        emitError: unexpected,
        emitQueue: unexpected,
        scheduleDrain: unexpected,
        interrupt: unexpected,
        awaitDrain: unexpected,
        syncMailboxMessages: unexpected,
        listAgents: () => agents.list(),
        excludedAgents: () => new Set(),
        isRunning: () => false,
        usageLimited: unexpected,
      },
    });
    const sync = new MailboxSync({
      database: agents.database,
      mailbox,
      conversation,
      routines,
      scope: () => scope,
      hooks: { emit: unexpected, emitError: unexpected, queueHold: unexpected },
    });
    const before = agents.database.readConversation(fixture.id, fixture.threadId);
    assert.equal(before.messages.length, 1);
    sync.reconcilePersistedMailboxMessages(fixture);
    const hydrated = agents.database.readConversation(fixture.id, fixture.threadId);
    assert.deepEqual(
      hydrated.messages,
      before.messages.map((message) => ({ ...message, reactions: [], reaction: null })),
    );
    assert.equal(hydrated.activeTurnId, null);
    assert.ok(hydrated.revision > before.revision, "Real reconciliation must persist the hydrated message.");
    return hydrated;
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    agents.database.close();
  }
}

async function persistFixtureEdit(expected: ConversationSnapshot, replacement: ConversationSnapshot) {
  const agents = new AgentStore(profile, homedir());
  await runCauseEffect(agents.initialize());
  try {
    assert.deepEqual(agents.database.readConversation(expected.agentId, expected.threadId), expected);
    agents.database.persistConversation(replacement, "spreadsheet-phonetic-safety-edit");
    const saved = agents.database.readConversation(expected.agentId, expected.threadId);
    assert.deepEqual(saved.messages, replacement.messages);
    return saved;
  } finally {
    agents.database.close();
  }
}

// Persist exact synthetic identity/configuration edits through the real roster store.
async function editAgent(expected: AgentSummary, replacement: AgentSummary) {
  const agents = new AgentStore(profile, homedir());
  await runCauseEffect(agents.initialize());
  try {
    assert.deepEqual(
      agents.list().find((agent) => agent.id === expected.id),
      expected,
    );
    agents.database.replaceAgents(
      `spreadsheet-safety:${crypto.randomUUID()}`,
      agents.list().map((agent) => (agent.id === expected.id ? replacement : agent)),
      "agent.updated",
    );
  } finally {
    agents.database.close();
  }
}

// Record all paths and bytes. Refusal must preserve the complete workspace.
function workspaceSnapshot(workspace: string): Record<string, string> {
  assert.equal(realpathSync(workspace), workspace);
  const entries: Record<string, string> = {};
  function visit(path: string, relative: string) {
    const stats = lstatSync(path);
    assert.equal(stats.isSymbolicLink(), false);
    if (stats.isDirectory()) {
      entries[relative] = "directory";
      for (const name of readdirSync(path).sort()) visit(resolve(path, name), `${relative}/${name}`);
    } else {
      assert.ok(stats.isFile() && stats.nlink === 1);
      entries[relative] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  }
  visit(workspace, ".");
  return entries;
}

// Use exact records here, including the URL. Restore only the synthetic value we wrote.
async function setRelayUrl(expected: OwnedRoutineRecord, url: string | null) {
  assert.equal(expected.trigger.kind, "webhook");
  const agents = new AgentStore(profile, homedir());
  await runCauseEffect(agents.initialize());
  try {
    const store = new AgentRoutineStore(agents.database);
    assert.deepEqual(store.getRecord(expected.ownerId, expected.id), expected, "Webhook changed; preserve state.");
    assert.ok(expected.trigger.kind === "webhook");
    new WebhookRouteStore(agents.database).setUrl(expected.trigger.routeId, url);
    const updated = store.getRecord(expected.ownerId, expected.id);
    assert.deepEqual(updated, { ...expected, trigger: { ...expected.trigger, url } });
    assert.ok(updated);
    return updated;
  } finally {
    agents.database.close();
  }
}

async function setRoutineName(expected: OwnedRoutineRecord, name: string) {
  const agents = new AgentStore(profile, homedir());
  await runCauseEffect(agents.initialize());
  try {
    const store = new AgentRoutineStore(agents.database);
    assert.deepEqual(store.getRecord(expected.ownerId, expected.id), expected, "Routine changed; preserve state.");
    assert.ok(expected.trigger.kind === "webhook");
    // Reuse the existing clock so this case proves that a name edit alone is refused.
    const updated = store.saveRecord(
      expected.ownerId,
      expected.id,
      {
        ...expected,
        name,
        trigger: {
          kind: "webhook",
          eventType: expected.trigger.eventType,
          filters: expected.trigger.filters,
          secretCiphertext: null,
        },
      },
      new Date(expected.updatedAt),
    );
    assert.deepEqual(updated, { ...expected, name });
    return updated;
  } finally {
    agents.database.close();
  }
}

// Pause/resume changes only these store-owned clock fields. All other seed data must match.
function stableRoutine(record: OwnedRoutineRecord) {
  const trigger =
    record.trigger.kind === "schedule"
      ? { ...record.trigger, updatedAt: null, nextRunAt: null }
      : { ...record.trigger, updatedAt: null };
  return createHash("sha256")
    .update(JSON.stringify({ ...record, updatedAt: null, trigger }))
    .digest("hex");
}

try {
  const named = process.argv.find((arg) => arg.startsWith("--instance="))?.slice(11);
  assertMutationAllowed({
    command: "spreadsheet-phonetic-fixture-safety-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: Boolean(named),
  });
  assert.equal(named, INSTANCE, "Require this worktree's isolated instance.");
  assert.equal(
    readDevInstanceRecords().some((entry) => entry.instanceId === INSTANCE),
    false,
  );
  assert.equal(await isDevelopmentProfileActive(profile), false);
  if (!existsSync(profile))
    await seedDevelopmentState({ instanceId: INSTANCE, ifMissing: true, agentModel: SEED_FALLBACK_AGENT });
  assert.equal(await isDevelopmentProfileActive(profile), false);
  requireSeedProfile();
  assert.equal(lstatSync(profile).isSymbolicLink(), false);
  assert.equal(realpathSync(profile), profile);
  assert.equal(JSON.parse(readFileSync(resolve(profile, DEVELOPMENT_SEED_MANIFEST_FILE), "utf8")).version, 1);
  assert.equal(existsSync(journalPath), false, "Existing journal requires normal fixture cleanup first.");
  const baseline = await snapshot();
  assert.equal(
    baseline.agents.some((agent) => agent.name === FIXTURE_NAME),
    false,
  );
  assert.equal(baseline.routines.filter((routine) => routine.active).length, 6);
  async function restored() {
    const current = await snapshot();
    assert.deepEqual(current.agents, baseline.agents, "Synthetic agent remains or seed agent changed.");
    assert.deepEqual(current.routines.map(stableRoutine), baseline.routines.map(stableRoutine));
    assert.equal(current.routines.filter((routine) => routine.active).length, 6);
    for (const routine of baseline.routines.filter((entry) => !entry.active)) {
      const unchanged = current.routines.find((entry) => entry.id === routine.id);
      assert.ok(unchanged);
      assert.equal(digest(unchanged), digest(routine), "Inactive seed routine changed.");
    }
    assert.equal(existsSync(journalPath), false, "Recovery journal remains.");
    report.cases.push(`${stage}: seed agents preserved, six routines active, synthetic agent and journal removed`);
  }

  stage = "Real builtin managed copies permit cleanup";
  command("prepare", 0);
  const prepared = await snapshot();
  const fixtures = prepared.agents.filter((agent) => agent.name === FIXTURE_NAME);
  assert.equal(fixtures.length, 1);
  const fixture = fixtures[0];
  assert.ok(fixture);
  assert.deepEqual(readdirSync(fixture.workspacePath), []);
  for (const slug of BUILTIN_SKILL_SLUGS) {
    const source = resolve(ROOT, "resources/managed-skills", slug, "SKILL.md");
    await Effect.runPromise(
      new ManagedSkillService(
        source,
        () => assert.fail("Managed skill collision."),
        () => assert.fail("Managed skill sync failed."),
        slug,
      ).syncAgent(fixture),
    );
    for (const folder of MANAGED_SKILL_FOLDERS) {
      const target = resolve(fixture.workspacePath, folder, slug);
      assert.deepEqual(readdirSync(target).sort(), [OWNERSHIP_MARKER, "SKILL.md"].sort());
      assert.deepEqual(readFileSync(resolve(target, "SKILL.md")), readFileSync(source));
      assert.equal(
        readFileSync(resolve(target, OWNERSHIP_MARKER), "utf8"),
        `${JSON.stringify({ managedBy: "openbot", slug, version: 1 })}\n`,
      );
    }
  }
  const managedWorkspace = workspaceSnapshot(fixture.workspacePath);
  assert.deepEqual(await snapshot(), prepared, "Managed sync changed agents or routines.");
  report.cases.push("Actual ManagedSkillService.syncAgent wrote all three builtins in both provider folders");

  stage = "Edited builtin skill refuses cleanup";
  const skill = resolve(fixture.workspacePath, MANAGED_SKILL_FOLDERS[0], BUILTIN_SKILL_SLUGS[0], "SKILL.md");
  const originalSkill = readFileSync(skill);
  const editedSkill = Buffer.concat([
    originalSkill,
    Buffer.from("\nSynthetic user edit: preserve this instruction.\n"),
  ]);
  const journalBefore = readFileSync(journalPath, "utf8");
  writeFileSync(skill, editedSkill);
  const editedWorkspace = workspaceSnapshot(fixture.workspacePath);
  command("cleanup", 1);
  assert.deepEqual(workspaceSnapshot(fixture.workspacePath), editedWorkspace);
  assert.deepEqual(await snapshot(), prepared, "Edited skill refusal changed agents or routines.");
  assert.equal(readFileSync(journalPath, "utf8"), journalBefore);
  report.cases.push(
    "Edited builtin skill with valid marker refuses cleanup and preserves workspace, agent and journal",
  );
  // Restore only this run's edit, after exact current workspace, record and journal checks.
  assert.deepEqual(workspaceSnapshot(fixture.workspacePath), editedWorkspace);
  assert.deepEqual(await snapshot(), prepared);
  assert.equal(readFileSync(journalPath, "utf8"), journalBefore);
  assert.deepEqual(readFileSync(skill), editedSkill);
  writeFileSync(skill, originalSkill);
  assert.deepEqual(workspaceSnapshot(fixture.workspacePath), managedWorkspace);

  stage = "Later workspace file refuses cleanup with managed copies";
  const marker = resolve(fixture.workspacePath, "safety-e2e-later-file.txt");
  const markerText = "Synthetic later file owned only by the fixture safety E2E.\n";
  writeFileSync(marker, markerText, { flag: "wx", mode: 0o600 });
  const laterWorkspace = workspaceSnapshot(fixture.workspacePath);
  command("cleanup", 1);
  assert.deepEqual(workspaceSnapshot(fixture.workspacePath), laterWorkspace);
  assert.equal(readFileSync(marker, "utf8"), markerText);
  assert.equal(readFileSync(journalPath, "utf8"), journalBefore);
  assert.deepEqual(await snapshot(), prepared, "Refusal changed agents or routines.");
  report.cases.push("Refusal preserves later workspace file, agent, routines and exact recovery journal");
  // Remove only this run's file, after exact current workspace, record and journal checks.
  assert.deepEqual(workspaceSnapshot(fixture.workspacePath), laterWorkspace);
  assert.deepEqual(await snapshot(), prepared);
  assert.equal(readFileSync(journalPath, "utf8"), journalBefore);
  assert.equal(lstatSync(marker).isSymbolicLink(), false);
  assert.equal(readFileSync(marker, "utf8"), markerText);
  unlinkSync(marker);
  assert.deepEqual(workspaceSnapshot(fixture.workspacePath), managedWorkspace);
  command("cleanup", 0);
  assert.equal(existsSync(fixture.workspacePath), false);
  report.cases.push("Exact builtin copies and ownership markers permit guarded cleanup");
  await restored();

  stage = "Actual app message hydration and meaningful message edit refusal";
  command("prepare", 0);
  const hydrationFixture = (await snapshot()).agents.find((agent) => agent.name === FIXTURE_NAME);
  assert.ok(hydrationFixture);
  const hydrationJournal = readFileSync(journalPath, "utf8");
  const hydrated = await hydrateMessages(hydrationFixture);
  const hydratedState = await snapshot();
  assert.equal(readFileSync(journalPath, "utf8"), hydrationJournal);
  report.cases.push("Actual MailboxSync reconciliation persists only empty reactions and null reaction");
  const message = hydrated.messages[0];
  assert.ok(message);
  const editedMessage = await persistFixtureEdit(hydrated, {
    ...hydrated,
    messages: [{ ...message, text: `${message.text}Synthetic meaningful message edit.\n` }],
  });
  const editedMessageState = await snapshot();
  command("cleanup", 1);
  assert.deepEqual(await snapshot(), editedMessageState, "Message edit refusal changed profile records.");
  assert.equal(readFileSync(journalPath, "utf8"), hydrationJournal);
  report.cases.push("Meaningful text edit after actual hydration refuses cleanup and preserves records and journal");
  // Restore only this run's text edit after exact current record and journal checks.
  assert.deepEqual(await snapshot(), editedMessageState);
  assert.equal(readFileSync(journalPath, "utf8"), hydrationJournal);
  await persistFixtureEdit(editedMessage, { ...editedMessage, messages: hydrated.messages });
  const restoredMessageState = await snapshot();
  assert.equal(restoredMessageState.mailboxHash, hydratedState.mailboxHash);
  assert.deepEqual(restoredMessageState.agents, hydratedState.agents);
  assert.deepEqual(restoredMessageState.routines, hydratedState.routines);
  command("cleanup", 0);
  report.cases.push("Normal cleanup accepts actual hydration with the original journal unchanged");
  await restored();

  stage = "Relay URL refresh preserves configuration guards";
  const webhook = (await snapshot()).routines.find((routine) => routine.active && routine.trigger.kind === "webhook");
  assert.ok(webhook && webhook.trigger.kind === "webhook");
  const initialUrl = "https://fixture.invalid/relay/initial";
  const refreshedUrl = "https://fixture.invalid/relay/refreshed";
  const registered = await setRelayUrl(webhook, initialUrl);
  command("prepare", 0);
  const relayPrepared = await snapshot();
  const relayPaused = relayPrepared.routines.find((routine) => routine.id === webhook.id);
  assert.ok(relayPaused && relayPaused.trigger.kind === "webhook");
  assert.equal(relayPaused.trigger.url, initialUrl, "Pause lost the registered relay URL.");
  const relayJournal = readFileSync(journalPath, "utf8");
  // The normalized hash has the exact format of an existing null-URL journal.
  const relayEntry = JSON.parse(relayJournal).paused.find((entry: { id: string }) => entry.id === webhook.id);
  assert.ok(relayEntry);
  assert.equal(relayEntry.before, digest({ ...registered, trigger: { ...registered.trigger, url: null } }));
  assert.equal(relayEntry.after, digest({ ...relayPaused, trigger: { ...relayPaused.trigger, url: null } }));
  const refreshed = await setRelayUrl(relayPaused, refreshedUrl);
  const edited = await setRoutineName(refreshed, `${refreshed.name} safety E2E edit`);
  const editedSnapshot = await snapshot();
  command("cleanup", 1);
  assert.deepEqual(await snapshot(), editedSnapshot, "Config refusal changed agents or routines.");
  assert.equal(readFileSync(journalPath, "utf8"), relayJournal, "Config refusal changed the journal.");
  report.cases.push("Name edit alone refuses cleanup and preserves agent, records and exact journal after URL refresh");
  // Restore only this run's name edit, after full state and journal checks.
  assert.deepEqual(await snapshot(), editedSnapshot);
  assert.equal(readFileSync(journalPath, "utf8"), relayJournal);
  assert.deepEqual(await setRoutineName(edited, refreshed.name), refreshed);
  command("cleanup", 0);
  const relayRestored = await snapshot();
  assert.deepEqual(relayRestored.agents, baseline.agents);
  assert.equal(existsSync(journalPath), false);
  const resumedWebhook = relayRestored.routines.find((routine) => routine.id === webhook.id);
  assert.ok(resumedWebhook && resumedWebhook.trigger.kind === "webhook");
  assert.equal(resumedWebhook.trigger.url, refreshedUrl, "Resume lost the refreshed relay URL.");
  const baselineWithUrl = { ...webhook, trigger: { ...webhook.trigger, url: refreshedUrl } };
  assert.deepEqual(
    relayRestored.routines.map(stableRoutine),
    baseline.routines.map((routine) => stableRoutine(routine.id === webhook.id ? baselineWithUrl : routine)),
  );
  // Restore the harness URL only if the complete observed state still matches.
  assert.deepEqual(await snapshot(), relayRestored);
  assert.equal(existsSync(journalPath), false);
  await setRelayUrl(resumedWebhook, webhook.trigger.url);
  report.cases.push("Relay refresh matches null-URL journal hashes; pause and resume preserve actual URLs");
  await restored();

  for (const fault of ["after-create", "after-thread", "after-attachment", "after-message"] as const) {
    stage = `Interrupted preparation ${fault} recovers`;
    const before = await snapshot();
    command("prepare", 86, fault);
    const interrupted = await snapshot();
    const owned = interrupted.agents.find((agent) => agent.name === FIXTURE_NAME);
    assert.ok(owned);
    assert.equal(interrupted.routines.filter((routine) => routine.active).length, 0);
    const journalBytes = readFileSync(journalPath, "utf8");
    const evidence = JSON.parse(journalBytes);
    assert.equal(evidence.ready, false);
    assert.equal(evidence.messagesHash, null);
    assert.equal(evidence.agentId, fault === "after-create" ? null : owned.id);
    assert.equal(evidence.paused.length, 6);
    for (const original of before.routines.filter((routine) => routine.active)) {
      const entry = evidence.paused.find((item: { id: string }) => item.id === original.id);
      assert.ok(entry);
      assert.equal(
        entry.before,
        digest(
          original.trigger.kind === "webhook" ? { ...original, trigger: { ...original.trigger, url: null } } : original,
        ),
      );
    }
    if (fault === "after-thread") {
      stage = "Incomplete preparation preserves unknown files and linked content";
      const marker = resolve(owned.workspacePath, "safety-owned-later.txt");
      const markerText = "Synthetic later file in incomplete preparation.\n";
      writeFileSync(marker, markerText, { flag: "wx", mode: 0o600 });
      const later = workspaceSnapshot(owned.workspacePath);
      command("cleanup", 1);
      assert.deepEqual(workspaceSnapshot(owned.workspacePath), later);
      assert.deepEqual(await snapshot(), interrupted);
      assert.equal(readFileSync(journalPath, "utf8"), journalBytes);
      assert.equal(readFileSync(marker, "utf8"), markerText);
      unlinkSync(marker);
      const link = resolve(owned.workspacePath, "safety-link");
      symlinkSync(owned.workspacePath, link);
      command("cleanup", 1);
      assert.ok(lstatSync(link).isSymbolicLink());
      assert.deepEqual(await snapshot(), interrupted);
      assert.equal(readFileSync(journalPath, "utf8"), journalBytes);
      unlinkSync(link);
      assert.deepEqual(readdirSync(owned.workspacePath), []);
      report.cases.push("Incomplete preparation refuses later files and links without changing records or journal");
      stage = "Incomplete preparation preserves identity and configuration edits";
      for (const replacement of [
        { ...owned, title: "Synthetic identity edit" },
        { ...owned, computerUse: false },
      ]) {
        await editAgent(owned, replacement);
        const changed = await snapshot();
        command("cleanup", 1);
        assert.deepEqual(await snapshot(), changed);
        assert.equal(readFileSync(journalPath, "utf8"), journalBytes);
        assert.deepEqual(readdirSync(owned.workspacePath), []);
        await editAgent(replacement, owned);
      }
      report.cases.push("Incomplete preparation refuses exact identity and configuration edits");
    }
    stage = `Interrupted preparation ${fault} recovers`;
    command("cleanup", 0);
    assert.equal(existsSync(owned.workspacePath), false);
    await restored();
  }

  stage = "Workspace removal before database deletion recovers";
  command("prepare", 0);
  const partial = (await snapshot()).agents.find((agent) => agent.name === FIXTURE_NAME);
  assert.ok(partial);
  command("cleanup", 86, "after-workspace-remove");
  const partialState = await snapshot();
  assert.deepEqual(
    partialState.agents.find((agent) => agent.id === partial.id),
    partial,
  );
  assert.equal(partialState.routines.filter((routine) => routine.active).length, 0);
  assert.equal(existsSync(partial.workspacePath), false);
  const partialJournal = readFileSync(journalPath, "utf8");
  assert.ok(JSON.parse(partialJournal).deletion);
  // Deletion intent must not authorize later files in a recreated workspace.
  mkdirSync(partial.workspacePath, { mode: 0o700 });
  const returned = resolve(partial.workspacePath, "safety-returned-file.txt");
  const returnedText = "Synthetic file returned after workspace removal.\n";
  writeFileSync(returned, returnedText, { flag: "wx", mode: 0o600 });
  const returnedWorkspace = workspaceSnapshot(partial.workspacePath);
  command("cleanup", 1);
  assert.deepEqual(workspaceSnapshot(partial.workspacePath), returnedWorkspace);
  assert.deepEqual(await snapshot(), partialState);
  assert.equal(readFileSync(journalPath, "utf8"), partialJournal);
  assert.equal(readFileSync(returned, "utf8"), returnedText);
  unlinkSync(returned);
  rmdirSync(partial.workspacePath);
  // A missing workspace does not relax the record or conversation guards.
  for (const replacement of [
    { ...partial, title: "Synthetic deletion identity edit" },
    { ...partial, notifications: false },
  ]) {
    await editAgent(partial, replacement);
    const changed = await snapshot();
    command("cleanup", 1);
    assert.deepEqual(await snapshot(), changed);
    assert.equal(existsSync(partial.workspacePath), false);
    assert.equal(readFileSync(journalPath, "utf8"), partialJournal);
    await editAgent(replacement, partial);
  }
  const partialAgents = new AgentStore(profile, homedir());
  await runCauseEffect(partialAgents.initialize());
  const partialConversation = partialAgents.database.readConversation(partial.id, partial.threadId);
  partialAgents.database.close();
  const partialMessage = partialConversation.messages[0];
  assert.ok(partialMessage);
  const changedConversation = await persistFixtureEdit(partialConversation, {
    ...partialConversation,
    messages: [{ ...partialMessage, text: "Synthetic deletion message edit" }],
  });
  const changedState = await snapshot();
  command("cleanup", 1);
  assert.deepEqual(await snapshot(), changedState);
  assert.equal(readFileSync(journalPath, "utf8"), partialJournal);
  await persistFixtureEdit(changedConversation, { ...changedConversation, messages: partialConversation.messages });
  report.cases.push("Partial deletion preserves returned files and changed identity, configuration and messages");
  command("cleanup", 0);
  assert.equal(existsSync(partial.workspacePath), false);
  await restored();

  stage = "Interrupted pause recovers";
  command("prepare", 86, "after-pause");
  assert.equal(existsSync(journalPath), true);
  const paused = await snapshot();
  assert.equal(paused.routines.filter((routine) => routine.active).length, 5);
  command("cleanup", 0);
  await restored();

  stage = "Interrupted resume recovers";
  command("prepare", 0);
  const resumeFixture = (await snapshot()).agents.find((agent) => agent.name === FIXTURE_NAME);
  assert.ok(resumeFixture);
  command("cleanup", 86, "after-resume");
  assert.equal(existsSync(journalPath), true);
  assert.equal((await snapshot()).routines.filter((routine) => routine.active).length, 1);
  command("cleanup", 0);
  assert.equal(existsSync(resumeFixture.workspacePath), false);
  await restored();
  stage = "Interrupted deletion recovers";
  command("prepare", 0);
  const deletionFixture = (await snapshot()).agents.find((agent) => agent.name === FIXTURE_NAME);
  assert.ok(deletionFixture);
  command("cleanup", 86, "after-delete");
  const deletionJournal = JSON.parse(readFileSync(journalPath, "utf8"));
  assert.equal(deletionJournal.agentId, deletionFixture.id);
  assert.ok(deletionJournal.deletion);
  const deleted = await snapshot();
  assert.deepEqual(deleted.agents, baseline.agents);
  assert.equal(deleted.routines.filter((routine) => routine.active).length, 0);
  assert.equal(existsSync(deletionFixture.workspacePath), false);
  command("cleanup", 0);
  await restored();
  report.passed = true;
} catch {
  // Preserve unexpected state for normal guarded cleanup. Never delete or repair it here.
  report.failure = `${stage} failed; preserve state and use guarded fixture cleanup.`;
} finally {
  mkdirSync(resolve(artifact, ".."), { recursive: true });
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`spreadsheet-phonetic-fixture-safety-e2e: ${report.passed ? "PASS" : "FAIL"}; ${artifact}\n`);
  if (!report.passed) process.exitCode = 1;
}
