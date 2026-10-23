// Offline only. Stop this worktree's app before prepare or cleanup. Never reset a profile.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentSummary, ConversationSnapshot } from "@openbot/contracts/ipc";
import { nextRoutineOccurrence } from "@openbot/team-client/routine-schedule";
import { z } from "zod";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { ChannelStore } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import type { OwnedRoutineRecord } from "../src/backend/routine-store";
import { developmentInstanceIdForWorktree, developmentUserDataName } from "../src/main/development-profile";
import { MANAGED_SKILL_FOLDERS, OWNERSHIP_MARKER } from "../src/main/managed-skill-service";
import { assertMutationAllowed } from "./dev-automation/cdp-client";
import { readDevInstanceRecords } from "./dev-automation/instance-registry";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";
import {
  DEVELOPMENT_SEED_MANIFEST_FILE,
  isDevelopmentProfileActive,
  SEED_FALLBACK_AGENT,
  seedDevelopmentState,
} from "./seed-dev-state";

export const ROOT = resolve(import.meta.dirname, "..");
export const BUILTIN_SKILL_SLUGS = ["openbot-site-hosting", "openbot-skill-creator", "openbot-data"] as const;
export const INSTANCE = developmentInstanceIdForWorktree(ROOT);
export const FIXTURE_NAME = "Markdown filter fixture";
export const FILENAMES = ["README.markdown", "README.md"] as const;
export const FIXTURE_HEADING = "Synthetic Markdown heading";
export const FIXTURE_BODY = "Synthetic Markdown filter fixture. No provider turn.";
export const FIXTURE_TEXT = `# ${FIXTURE_HEADING}\n\n${FIXTURE_BODY}\n`;
const MARKER = "markdown-files-filter-v1";
export const profile = resolve(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", INSTANCE));
export const journalPath = resolve(profile, `${MARKER}.json`);
const journalSchema = z.object({
  version: z.literal(2),
  instance: z.literal(INSTANCE),
  agentId: z
    .string()
    .regex(/^agent-[a-f0-9-]+$/u)
    .nullable(),
  ready: z.boolean(),
  deleting: z.object({ agent: z.string(), conversation: z.string() }).optional(),
  paused: z.array(
    z.object({
      kind: z.enum(["agent", "channel"]),
      owner: z.string(),
      id: z.string(),
      before: z.string(),
      after: z.string(),
      resume: z.object({ before: z.string(), after: z.string(), at: z.string() }).optional(),
    }),
  ),
});
type Journal = z.infer<typeof journalSchema>;

function readJournal(): Journal {
  return journalSchema.parse(JSON.parse(readFileSync(journalPath, "utf8")));
}

export function requireFixture(): string {
  const journal = readJournal();
  assert.ok(journal.ready && journal.agentId && !journal.deleting, "Prepare the offline fixture first.");
  return journal.agentId;
}

export function digest(record: OwnedRoutineRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

// Relay registration updates only this derived URL, without changing configuration or clocks.
// Keep null in its original position so existing journals written with url=null still match.
function routineDigest(record: OwnedRoutineRecord): string {
  return digest(record.trigger.kind === "webhook" ? { ...record, trigger: { ...record.trigger, url: null } } : record);
}

function fields(record: OwnedRoutineRecord, active: boolean) {
  return {
    ...record,
    active,
    trigger:
      record.trigger.kind === "schedule"
        ? { kind: "schedule" as const, schedule: record.trigger.schedule }
        : {
            kind: "webhook" as const,
            eventType: record.trigger.eventType,
            filters: record.trigger.filters,
            secretCiphertext: null,
          },
  };
}

// The store accepts an explicit time. Hash the exact expected result before changing it.
// No instruction, webhook secret, or other record value enters the journal.
function transition(record: OwnedRoutineRecord, active: boolean, now: Date): OwnedRoutineRecord {
  const updatedAt = now.toISOString();
  const trigger = { ...record.trigger };
  if (trigger.kind === "webhook") trigger.updatedAt = updatedAt;
  else if (!record.active && active) {
    trigger.updatedAt = updatedAt;
    trigger.nextRunAt = nextRoutineOccurrence(trigger.schedule, record.timezone, now).toISOString();
  }
  return { ...record, active, updatedAt, trigger };
}

// Test-only opt-in. Exit at a saved transition or after a store commit.
// Recovery uses only the saved ownership checks and exact before/after hashes.
function interrupt(point: string) {
  if (process.argv.includes(`--fixture-interrupt=${point}`)) process.exit(86);
}

function deletionPaths(agentId: string) {
  const expected = resolve(homedir(), "OpenBot/Agents", agentId);
  return [
    resolve(homedir(), "OpenBot/Bots", agentId.replace(/^agent-/u, "bot-")),
    resolve(profile, "avatars/agents", agentId.replace(/^agent-/u, "bot-")),
    `${expected}.openbot-stage`,
    resolve(homedir(), "OpenBot/Bots", agentId),
    resolve(profile, "avatars/agents", agentId),
    resolve(profile, "avatars/agents", `${agentId}.openbot-stage`),
    resolve(profile, "agent-duplications", `${agentId}.pending`),
  ];
}

function assertAbsent(path: string) {
  // lstat also detects dangling links. Never pass an unknown path to recursive removal.
  assert.equal(
    lstatSync(path, { throwIfNoEntry: false }),
    undefined,
    "Unexpected fixture data; preserve it and the journal.",
  );
}

function deletionDigest(value: AgentSummary | ConversationSnapshot): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertOwnedWorkspace(agentId: string, workspacePath: string, deleting = false) {
  const expected = resolve(homedir(), "OpenBot/Agents", agentId);
  assert.equal(workspacePath, expected, "Fixture workspace changed; preserve it and the journal.");
  for (const path of deletionPaths(agentId)) assertAbsent(path);
  assert.equal(realpathSync(dirname(expected)), dirname(expected), "Fixture workspace parent changed; preserve it.");
  // AgentStore removes files before its roster transaction. Only a saved, verified
  // deletion may accept a missing workspace; any surviving files still need all checks.
  if (deleting && !lstatSync(expected, { throwIfNoEntry: false })) return;
  assert.ok(lstatSync(expected).isDirectory(), "Fixture workspace is not a directory; preserve it.");
  assert.equal(lstatSync(expected).isSymbolicLink(), false, "Linked fixture workspace; preserve it.");
  assert.equal(realpathSync(expected), expected, "Fixture workspace parent changed; preserve it.");
  // App startup writes only these builtin copies. A marker alone never proves ownership.
  // Generated attachments live in MailboxStore, not in the workspace.
  const files = new Map<string, Buffer>();
  const directories = new Set<string>([expected]);
  const skillDirectories = new Set<string>();
  for (const slug of BUILTIN_SKILL_SLUGS) {
    const content = readFileSync(resolve(ROOT, "resources/managed-skills", slug, "SKILL.md"));
    const ownership = Buffer.from(`${JSON.stringify({ managedBy: "openbot", slug, version: 1 })}\n`);
    for (const folder of MANAGED_SKILL_FOLDERS) {
      const directory = resolve(expected, folder, slug);
      skillDirectories.add(directory);
      files.set(resolve(directory, "SKILL.md"), content);
      files.set(resolve(directory, OWNERSHIP_MARKER), ownership);
      for (let parent = directory; parent !== expected; parent = dirname(parent)) directories.add(parent);
    }
  }
  function check(directory: string) {
    const names = readdirSync(directory).sort();
    if (skillDirectories.has(directory))
      assert.deepEqual(names, [OWNERSHIP_MARKER, "SKILL.md"].sort(), "Incomplete managed copy; preserve workspace.");
    for (const name of names) {
      const path = resolve(directory, name);
      const stats = lstatSync(path);
      assert.equal(stats.isSymbolicLink(), false, "Linked workspace content; preserve it and the journal.");
      if (stats.isDirectory()) {
        assert.ok(directories.has(path), "Unexpected workspace directory; preserve it and the journal.");
        check(path);
      } else {
        const bytes = files.get(path);
        assert.ok(
          bytes && stats.isFile() && stats.nlink === 1,
          "Unexpected workspace file; preserve it and the journal.",
        );
        assert.deepEqual(readFileSync(path), bytes, "Managed content changed; preserve it and the journal.");
      }
    }
  }
  check(expected);
}

async function main() {
  const action = process.argv[2];
  assert.ok(action === "prepare" || action === "cleanup", "Use prepare or cleanup.");
  const fault = process.argv.find((arg) => arg.startsWith("--fixture-interrupt="));
  assert.ok(
    !fault ||
      (action === "prepare" && fault === "--fixture-interrupt=after-pause") ||
      (action === "cleanup" &&
        [
          "--fixture-interrupt=after-resume",
          "--fixture-interrupt=before-agent-delete",
          "--fixture-interrupt=after-agent-delete",
        ].includes(fault)),
    "Invalid fixture interruption option.",
  );
  const named = process.argv.find((arg) => arg.startsWith("--instance="))?.slice(11);
  assertMutationAllowed({
    command: MARKER,
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: Boolean(named),
  });
  assert.equal(named, INSTANCE, "Require this worktree's isolated instance.");
  async function inactive() {
    assert.equal(
      readDevInstanceRecords().some((entry) => entry.instanceId === INSTANCE),
      false,
      "Stop the registered app first.",
    );
    assert.equal(await isDevelopmentProfileActive(profile), false, "Profile is active or its lock cannot be verified.");
  }
  await inactive();
  if (!existsSync(profile)) {
    assert.equal(action, "prepare", "No fixture profile exists.");
    await seedDevelopmentState({ instanceId: INSTANCE, ifMissing: true, agentModel: SEED_FALLBACK_AGENT });
  }
  assert.equal(lstatSync(profile).isSymbolicLink(), false, "Refuse a linked profile.");
  assert.equal(
    realpathSync(profile),
    resolve(realpathSync(resolveDevelopmentAppDataRoot()), developmentUserDataName("app", INSTANCE)),
  );
  z.object({ version: z.literal(1), createdAt: z.string(), transferDirectories: z.array(z.string()) }).parse(
    JSON.parse(readFileSync(resolve(profile, DEVELOPMENT_SEED_MANIFEST_FILE), "utf8")),
  );
  await inactive();
  if (action === "prepare")
    assert.equal(existsSync(journalPath), false, "Fixture exists; cleanup before preparing again.");
  const journal: Journal =
    action === "cleanup" ? readJournal() : { version: 2, instance: INSTANCE, agentId: null, ready: false, paused: [] };
  const save = () => {
    const temporary = `${journalPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, journalPath);
  };
  const agents = new AgentStore(profile, homedir());
  await runCauseEffect(agents.initialize());
  try {
    const mailbox = new MailboxStore(profile, agents.sharedRoot, agents.database);
    await runCauseEffect(mailbox.initialize());
    const agentRoutines = new AgentRoutineStore(agents.database);
    const channelRoutines = new ChannelRoutineStore(agents.database);
    const channels = new ChannelStore(agents.database);
    assert.ok(
      agents.list().every((agent) => !mailbox.hasUnfinishedDelivery(agent.id)),
      "Unfinished deliveries require coordinator action.",
    );
    assert.equal(
      agentRoutines.pendingRuns().length + channelRoutines.pendingRuns().length,
      0,
      "Pending routine runs require coordinator action.",
    );
    const channelList = channels.list("local");
    assert.ok(
      channelList.every(
        (channel) =>
          channels.tasks(channel.id).every((task) => !["queued", "running"].includes(task.state)) &&
          channels
            .assignments(channel.id)
            .every((assignment) => !["queued", "starting", "running"].includes(assignment.state)),
      ),
      "Unfinished channel work requires coordinator action.",
    );
    if (action === "prepare") {
      const known = new Map([
        [
          "chief:Morning launch brief",
          "Summarize launch progress, blockers, owners, and the next decision in five bullets.",
        ],
        [
          "chief:Friday launch review",
          "Prepare the weekly launch review with decisions, risks, and unresolved ownership gaps.",
        ],
        [
          "research:Daily source check",
          "Recheck open launch claims against primary sources and report only material changes.",
        ],
        [
          "launch:Release readiness pulse",
          "Check release assets, messaging, and approvals, then list anything blocking publication.",
        ],
        [
          "launch:Release published",
          "Check the published release's notes and assets, then list the three things the team does next.",
        ],
        [
          "channel-launch-room:Daily launch standup",
          "Post the launch standup: progress since yesterday, blockers, and the next decision.",
        ],
      ]);
      const records = [
        ...agents
          .list()
          .flatMap((agent) =>
            agentRoutines.listRecords(agent.id).map((record) => ({ kind: "agent" as const, record })),
          ),
        ...channelList.flatMap((channel) =>
          channelRoutines.listRecords(channel.id).map((record) => ({ kind: "channel" as const, record })),
        ),
      ].filter(({ record }) => record.active);
      assert.ok(
        records.every(({ record }) => known.get(`${record.ownerId}:${record.name}`) === record.instruction),
        "Unknown active routine; no changes made.",
      );
      save();
      for (const { kind, record } of records) {
        const store = kind === "agent" ? agentRoutines : channelRoutines;
        const now = new Date();
        const after = routineDigest(transition(record, false, now));
        journal.paused.push({ kind, owner: record.ownerId, id: record.id, before: routineDigest(record), after });
        save();
        const paused = store.saveRecord(record.ownerId, record.id, fields(record, false), now);
        interrupt("after-pause");
        assert.equal(routineDigest(paused), after, "Pause result differs; preserve the journal.");
      }
      const agent = await runCauseEffect(
        agents.createAgent({ name: FIXTURE_NAME, description: MARKER, avatarSeed: MARKER, avatarHue: null }),
      );
      journal.agentId = agent.id;
      save();
      const threadId = await runCauseEffect(agents.ensureThreadId(agent.id));
      const attachments = [];
      for (const name of FILENAMES) {
        attachments.push(
          await runCauseEffect(
            mailbox.storeGeneratedAttachment({
              name,
              mimeType: "text/markdown",
              bytes: Buffer.from(FIXTURE_TEXT),
              ownerAgentId: agent.id,
              ownerThreadId: threadId,
            }),
          ),
        );
      }
      agents.database.persistConversation(
        {
          agentId: agent.id,
          threadId,
          activeTurnId: null,
          revision: 0,
          messages: [
            {
              id: MARKER,
              author: "assistant",
              status: "completed",
              text: FIXTURE_TEXT,
              createdAt: new Date().toISOString(),
              attachments,
            },
          ],
        },
        `${MARKER}.created`,
      );
      journal.ready = true;
      save();
    } else {
      // Validate every record before deleting any fixture data or resuming any routine.
      for (const entry of journal.paused) {
        const store = entry.kind === "agent" ? agentRoutines : channelRoutines;
        const current = store.getRecord(entry.owner, entry.id);
        const allowed = entry.resume ? [entry.resume.before, entry.resume.after] : [entry.before, entry.after];
        assert.ok(current && allowed.includes(routineDigest(current)), "Routine changed; preserve it and the journal.");
      }
      if (journal.agentId) {
        const agent = agents.list().find((entry) => entry.id === journal.agentId);
        if (!agent) {
          assert.ok(journal.deleting, "Fixture agent is missing; preserve the journal for coordinator action.");
          // Do not call deleteAgent for a missing record: it recursively removes derived
          // paths even without an agent. Reconcile completion only when all paths are gone.
          for (const path of [resolve(homedir(), "OpenBot/Agents", journal.agentId), ...deletionPaths(journal.agentId)])
            assertAbsent(path);
        } else {
          assert.equal(agent.name, FIXTURE_NAME, "Fixture agent changed; preserve it.");
          assert.equal(agent.description, MARKER, "Fixture agent changed; preserve it.");
          const snapshot = agents.database.readConversation(agent.id, agent.threadId);
          assert.equal(snapshot.activeTurnId, null, "Fixture agent is active.");
          assert.ok(
            snapshot.messages.every(
              (message) =>
                message.id === MARKER &&
                message.text === FIXTURE_TEXT &&
                message.status === "completed" &&
                message.author === "assistant" &&
                message.attachments?.length === FILENAMES.length &&
                message.attachments.every((attachment) => FILENAMES.some((name) => name === attachment.name)),
            ),
            "Fixture has unrelated messages; preserve it.",
          );
          const deletion = { agent: deletionDigest(agent), conversation: deletionDigest(snapshot) };
          if (journal.deleting)
            assert.deepEqual(deletion, journal.deleting, "Deleting fixture changed; preserve it and the journal.");
          assertOwnedWorkspace(agent.id, agent.workspacePath, Boolean(journal.deleting));
          journal.deleting = deletion;
          save();
          interrupt("before-agent-delete");
          await runCauseEffect(mailbox.deleteAgentData(agent.id));
          await runCauseEffect(agents.deleteAgent(agent.id));
          interrupt("after-agent-delete");
        }
        journal.agentId = null;
        delete journal.deleting;
        save();
      }
      while (journal.paused.length > 0) {
        const entry = journal.paused.at(-1);
        assert.ok(entry);
        const store = entry.kind === "agent" ? agentRoutines : channelRoutines;
        const current = store.getRecord(entry.owner, entry.id);
        assert.ok(current, "Routine missing; preserve the journal.");
        if (entry.resume) {
          assert.ok(
            [entry.resume.before, entry.resume.after].includes(routineDigest(current)),
            "Resuming routine changed; preserve it and the journal.",
          );
          if (routineDigest(current) === entry.resume.before) {
            const resumed = store.saveRecord(entry.owner, entry.id, fields(current, true), new Date(entry.resume.at));
            assert.equal(routineDigest(resumed), entry.resume.after, "Resume result differs; preserve the journal.");
          }
        } else {
          assert.ok(
            [entry.before, entry.after].includes(routineDigest(current)),
            "Paused routine changed; preserve it and the journal.",
          );
          if (!current.active) {
            const now = new Date();
            entry.resume = {
              before: routineDigest(current),
              after: routineDigest(transition(current, true, now)),
              at: now.toISOString(),
            };
            save();
            const resumed = store.saveRecord(entry.owner, entry.id, fields(current, true), now);
            interrupt("after-resume");
            assert.equal(routineDigest(resumed), entry.resume.after, "Resume result differs; preserve the journal.");
          }
        }
        journal.paused.pop();
        save();
      }
      unlinkSync(journalPath);
    }
    process.stdout.write(`${MARKER}: ${action} complete.\n`);
  } finally {
    agents.database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // Only our assertion messages are safe to print; store errors may contain private state.
    process.stderr.write(
      `${MARKER}: ${error instanceof assert.AssertionError ? error.message.split("\n")[0] : "Store or profile access failed; state was not exported."}\n`,
    );
    process.exitCode = 1;
  });
}
