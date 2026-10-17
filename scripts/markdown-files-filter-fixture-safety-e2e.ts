// Offline real-store/process check. Run only against this inactive isolated seed profile:
// bun scripts/markdown-files-filter-fixture-safety-e2e.ts --instance=<worktree-id> --allow-mutations
// Fixture-only --fixture-interrupt=after-pause|after-resume|before-agent-delete|after-agent-delete exits 86 after the store
// transition or store commit. A normal cleanup must recover without journal edits.
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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Effect } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { ChannelStore } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { OwnedRoutineRecord } from "../src/backend/routine-store";
import { WebhookRouteStore } from "../src/backend/webhook-route-store";
import { MANAGED_SKILL_FOLDERS, ManagedSkillService, OWNERSHIP_MARKER } from "../src/main/managed-skill-service";
import { assertMutationAllowed } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import {
  BUILTIN_SKILL_SLUGS,
  digest,
  FIXTURE_NAME,
  INSTANCE,
  journalPath,
  profile,
  ROOT,
} from "./markdown-files-filter-fixture";
import { DEVELOPMENT_SEED_MANIFEST_FILE, isDevelopmentProfileActive } from "./seed-dev-state";

const artifact = resolve(ROOT, ".openbot-build/markdown-files-filter-fixture-safety-e2e/report.json");
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
  fault?: "after-pause" | "after-resume" | "before-agent-delete" | "after-agent-delete",
) {
  const argv = [
    process.execPath,
    resolve(import.meta.dirname, "markdown-files-filter-fixture.ts"),
    action,
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
      routines: [
        ...agents.list().flatMap((agent) => agentRoutines.listRecords(agent.id)),
        ...channels.list("local").flatMap((channel) => channelRoutines.listRecords(channel.id)),
      ].sort((a, b) => a.id.localeCompare(b.id)),
    };
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
    command: "markdown-files-filter-fixture-safety-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: Boolean(named),
  });
  assert.equal(named, INSTANCE, "Require this worktree's isolated instance.");
  assert.equal(
    readDevInstanceRecords().some((entry) => entry.instanceId === INSTANCE),
    false,
  );
  assert.equal(await isDevelopmentProfileActive(profile), false);
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
    await Effect.runPromise(new ManagedSkillService(source, undefined, undefined, slug).syncAgent(fixture));
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

  stage = "Interrupted pause recovers";
  command("prepare", 86, "after-pause");
  assert.equal(existsSync(journalPath), true);
  const paused = await snapshot();
  assert.equal(paused.routines.filter((routine) => routine.active).length, 5);
  command("cleanup", 0);
  await restored();

  stage = "Saved deletion intent retains workspace ownership guards";
  command("prepare", 0);
  const deletingPrepared = await snapshot();
  const deletingFixture = deletingPrepared.agents.find((agent) => agent.name === FIXTURE_NAME);
  assert.ok(deletingFixture);
  command("cleanup", 86, "before-agent-delete");
  const deletingJournal = readFileSync(journalPath, "utf8");
  assert.equal(JSON.parse(deletingJournal).agentId, deletingFixture.id);
  assert.ok(JSON.parse(deletingJournal).deleting);
  const deletingMarker = resolve(deletingFixture.workspacePath, "safety-e2e-deletion-edit.txt");
  writeFileSync(deletingMarker, markerText, { flag: "wx", mode: 0o600 });
  const deletingWorkspace = workspaceSnapshot(deletingFixture.workspacePath);
  command("cleanup", 1);
  assert.deepEqual(workspaceSnapshot(deletingFixture.workspacePath), deletingWorkspace);
  assert.deepEqual(await snapshot(), deletingPrepared);
  assert.equal(readFileSync(journalPath, "utf8"), deletingJournal);
  // Remove only the harness file after exact state checks. Never repair the journal.
  assert.deepEqual(workspaceSnapshot(deletingFixture.workspacePath), deletingWorkspace);
  assert.deepEqual(await snapshot(), deletingPrepared);
  assert.equal(readFileSync(journalPath, "utf8"), deletingJournal);
  assert.equal(readFileSync(deletingMarker, "utf8"), markerText);
  unlinkSync(deletingMarker);
  assert.deepEqual(readdirSync(deletingFixture.workspacePath), []);
  // AgentStore can stop after workspace removal and before the roster transaction.
  // Remove only the verified empty harness workspace to exercise that retry state.
  rmdirSync(deletingFixture.workspacePath);
  assert.equal(readFileSync(journalPath, "utf8"), deletingJournal);
  assert.deepEqual(await snapshot(), deletingPrepared);
  command("cleanup", 0);
  assert.equal(existsSync(deletingFixture.workspacePath), false);
  await restored();

  stage = "Interrupted agent deletion recovers without journal repair";
  command("prepare", 0);
  const deletionPrepared = await snapshot();
  const deletedFixture = deletionPrepared.agents.find((agent) => agent.name === FIXTURE_NAME);
  assert.ok(deletedFixture);
  command("cleanup", 86, "after-agent-delete");
  const deletionJournal = readFileSync(journalPath, "utf8");
  assert.equal(JSON.parse(deletionJournal).agentId, deletedFixture.id);
  assert.ok(JSON.parse(deletionJournal).deleting);
  assert.equal(existsSync(deletedFixture.workspacePath), false);
  const deletionInterrupted = await snapshot();
  assert.deepEqual(deletionInterrupted.agents, baseline.agents);
  assert.deepEqual(deletionInterrupted.routines, deletionPrepared.routines);
  assert.equal(deletionInterrupted.routines.filter((routine) => routine.active).length, 0);
  // Even after roster deletion, unknown files must be preserved. Normal cleanup
  // must refuse without deleting the new path or changing any routine or journal.
  mkdirSync(deletedFixture.workspacePath, { mode: 0o700 });
  const returnedMarker = resolve(deletedFixture.workspacePath, "safety-e2e-returned-file.txt");
  writeFileSync(returnedMarker, markerText, { flag: "wx", mode: 0o600 });
  const returnedWorkspace = workspaceSnapshot(deletedFixture.workspacePath);
  command("cleanup", 1);
  assert.deepEqual(workspaceSnapshot(deletedFixture.workspacePath), returnedWorkspace);
  assert.deepEqual(await snapshot(), deletionInterrupted);
  assert.equal(readFileSync(journalPath, "utf8"), deletionJournal);
  // Remove only the exact harness content. The journal stays byte-for-byte unchanged.
  assert.deepEqual(workspaceSnapshot(deletedFixture.workspacePath), returnedWorkspace);
  assert.deepEqual(await snapshot(), deletionInterrupted);
  assert.equal(readFileSync(journalPath, "utf8"), deletionJournal);
  assert.equal(readFileSync(returnedMarker, "utf8"), markerText);
  unlinkSync(returnedMarker);
  rmdirSync(deletedFixture.workspacePath);
  command("cleanup", 0);
  assert.equal(existsSync(deletedFixture.workspacePath), false);
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
  report.passed = true;
} catch {
  // Preserve unexpected state for normal guarded cleanup. Never delete or repair it here.
  report.failure = `${stage} failed; preserve state and use guarded fixture cleanup.`;
} finally {
  mkdirSync(resolve(artifact, ".."), { recursive: true });
  writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`markdown-files-filter-fixture-safety-e2e: ${report.passed ? "PASS" : "FAIL"}; ${artifact}\n`);
  if (!report.passed) process.exitCode = 1;
}
