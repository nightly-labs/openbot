// Offline only. Stop this worktree's app before prepare or cleanup. Never reset a profile.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type AgentSummary, type ConversationMessage, DEFAULT_AGENT_ACCESS } from "@openbot/contracts/ipc";
import { nextRoutineOccurrence } from "@openbot/team-client/routine-schedule";
import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import {
  AgentStore,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
} from "../src/backend/agent-store";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { ChannelStore } from "../src/backend/channel-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { stableThreadId } from "../src/backend/openbot-database";
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
export const FIXTURE_NAME = "Spreadsheet phonetic fixture";
export const FILENAMES = ["spreadsheet-phonetic-inline.xlsx", "spreadsheet-phonetic-shared.xlsx"] as const;
export const OUT = resolve(ROOT, ".openbot-build/spreadsheet-phonetic-e2e");
const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

// Expected values are the base text in ECMA-376 CT_Rst. rPh is pronunciation metadata.
export const CASES = [
  { id: "plain-control", expected: "漢字", rich: false, annotated: false },
  { id: "plain-phonetic", expected: "漢字", rich: false, annotated: true },
  { id: "rich-control", expected: "漢字", rich: true, annotated: false },
  { id: "rich-phonetic", expected: "漢字", rich: true, annotated: true },
  { id: "space-plain-control", expected: " 漢 字 ", rich: false, annotated: false },
  { id: "space-plain-phonetic", expected: " 漢 字 ", rich: false, annotated: true },
  { id: "space-rich-control", expected: " 漢 字 ", rich: true, annotated: false },
  { id: "space-rich-phonetic", expected: " 漢 字 ", rich: true, annotated: true },
];

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function workbookBytes(shared: boolean): Uint8Array {
  const values = CASES.map((entry) => {
    // No formatting whitespace between XML nodes: textContent must fail only on rPh.
    const base = entry.rich
      ? [...entry.expected].map((text) => `<r><rPr><b/></rPr><t xml:space="preserve">${text}</t></r>`).join("")
      : `<t xml:space="preserve">${entry.expected}</t>`;
    const start = entry.expected.indexOf("漢");
    const end = entry.expected.indexOf("字") + 1;
    return base + (entry.annotated ? `<rPh sb="${start}" eb="${end}"><t>かんじ</t></rPh>` : "");
  });
  const cell = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const entries: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${shared ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : ""}</Types>`,
    "_rels/.rels": `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Phonetic ${shared ? "shared" : "inline"}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${PACKAGE_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>${shared ? `<Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` : ""}</Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${NS}"><sheetData><row r="1">${cell("A1", "Case")}${cell("B1", "Value")}</row>${CASES.map(
      (entry, index) => {
        const row = index + 2;
        return `<row r="${row}">${cell(`A${row}`, entry.id)}<c r="B${row}" t="${shared ? "s" : "inlineStr"}">${shared ? `<v>${index}</v>` : `<is>${values[index]}</is>`}</c></row>`;
      },
    ).join("")}</sheetData></worksheet>`,
  };
  if (shared)
    entries["xl/sharedStrings.xml"] =
      `<sst xmlns="${NS}" count="${values.length}" uniqueCount="${values.length}">${values.map((value) => `<si>${value}</si>`).join("")}</sst>`;
  // Fix ZIP timestamps so before/after hashes identify the same fixture bytes.
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, xml]) => [name, strToU8(xml)])), {
    mtime: new Date("2020-01-01T00:00:00Z"),
  });
}

export function writeWorkbooks(phase: "before" | "after") {
  const out = resolve(OUT, phase);
  mkdirSync(out, { recursive: true });
  const fixtures = FILENAMES.map((filename, index) => {
    const bytes = workbookBytes(index === 1);
    writeFileSync(resolve(out, filename), bytes);
    return { filename, sha256: sha256(bytes) };
  });
  writeFileSync(
    resolve(out, "fixture.json"),
    `${JSON.stringify({ instance: INSTANCE, fixtures, cases: CASES }, null, 2)}\n`,
  );
  return fixtures;
}
export const FIXTURE_TEXT = "Synthetic Spreadsheet phonetic fixture. No provider turn.\n";
const MARKER = "spreadsheet-phonetic-v1";
export const profile = resolve(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", INSTANCE));
export const journalPath = resolve(profile, `${MARKER}.json`);
const journalSchema = z.object({
  version: z.literal(2),
  deletion: z
    .object({
      agentHash: z.string(),
      threadId: z.string().nullable(),
      attachmentsHash: z.string().optional(),
      attachmentTrees: z.array(z.object({ directory: z.string(), files: z.record(z.string(), z.string()) })).optional(),
    })
    .nullable(),
  instance: z.literal(INSTANCE),
  agentId: z
    .string()
    .regex(/^agent-[a-f0-9-]+$/u)
    .nullable(),
  preparation: z
    .object({
      creationSeed: z.string(),
      agentHashes: z.array(z.string()),
      attachmentIds: z.array(z.string()),
      pendingAttachment: z.number().int().min(0).max(1).nullable(),
      generatedBefore: z.array(z.string()),
      workspacesBefore: z.array(z.string()),
      messageHashes: z.array(z.string()),
    })
    .optional(),
  ready: z.boolean(),
  messagesHash: z.string().nullable(),
  fixtures: z.array(z.object({ filename: z.string(), sha256: z.string() })),
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
  const stats = lstatSync(journalPath);
  assert.ok(stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1, "Refuse an unsafe fixture journal.");
  return journalSchema.parse(JSON.parse(readFileSync(journalPath, "utf8")));
}

export function requireSeedProfile() {
  assert.equal(lstatSync(profile).isSymbolicLink(), false, "Refuse a linked profile.");
  assert.equal(
    realpathSync(profile),
    resolve(realpathSync(resolveDevelopmentAppDataRoot()), developmentUserDataName("app", INSTANCE)),
    "Profile path does not belong to this worktree's isolated instance.",
  );
  const manifest = resolve(profile, DEVELOPMENT_SEED_MANIFEST_FILE);
  const stats = lstatSync(manifest);
  assert.ok(stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1, "Refuse an unsafe seed manifest.");
  z.object({ version: z.literal(1), createdAt: z.string(), transferDirectories: z.array(z.string()) }).parse(
    JSON.parse(readFileSync(manifest, "utf8")),
  );
}

export function requireFixture() {
  requireSeedProfile();
  const journal = readJournal();
  assert.ok(journal.ready && journal.agentId, "Prepare the offline fixture first.");
  assert.deepEqual(
    journal.fixtures,
    FILENAMES.map((filename, index) => ({ filename, sha256: sha256(workbookBytes(index === 1)) })),
    "Fixture bytes changed; prepare again after cleanup.",
  );
  return { agentId: journal.agentId, fixtures: journal.fixtures };
}

export function digest(record: OwnedRoutineRecord): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

// MailboxSync.syncMailboxMessages adds this exact empty pair; its reconciliation persists it.
// Prepare writes neither field. Reconstruct those original bytes, including key order, so the
// existing journal remains the authority. Retain real reactions and every attachment field.
function preparedMessagesHash(messages: ConversationMessage[]): string {
  return sha256(
    JSON.stringify(
      messages.map((message) => {
        if (!Array.isArray(message.reactions) || message.reactions.length !== 0 || message.reaction !== null)
          return message;
        const prepared = { ...message };
        delete prepared.reactions;
        delete prepared.reaction;
        return prepared;
      }),
    ),
  );
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

// Test-only opt-in. Exit after the store commit, before journal completion.
// Recovery uses only the already saved exact before/after hashes.
function interrupt(point: string) {
  if (process.argv.includes(`--fixture-interrupt=${point}`)) process.exit(86);
}

function assertOwnedWorkspace(agentId: string, workspacePath: string, deleting = false) {
  const expected = resolve(homedir(), "OpenBot/Agents", agentId);
  assert.equal(workspacePath, expected, "Fixture workspace changed; preserve it and the journal.");
  const workspace = lstatSync(expected, { throwIfNoEntry: false });
  if (deleting && !workspace) {
    assert.equal(realpathSync(dirname(expected)), dirname(expected), "Linked workspace parent; preserve state.");
    for (const path of deletionPaths(agentId))
      assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined, "Unexpected deletion data; preserve it.");
    return;
  }
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
    if (!deleting && skillDirectories.has(directory))
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
  for (const path of deletionPaths(agentId).filter((path) => path !== expected))
    assert.equal(
      lstatSync(path, { throwIfNoEntry: false }),
      undefined,
      "Unexpected fixture data; preserve it and the journal.",
    );
}

// Top-level agent fields have stable values, but the projection can change their key order.
function agentFingerprint(agent: AgentSummary): string {
  return sha256(JSON.stringify(Object.fromEntries(Object.entries(agent).sort(([a], [b]) => a.localeCompare(b)))));
}

function initialAgent(id: string, seed: string): AgentSummary {
  return {
    id,
    name: FIXTURE_NAME,
    title: "",
    description: MARKER,
    notifications: true,
    provider: DEFAULT_AGENT_PROVIDER,
    model: DEFAULT_AGENT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    access: DEFAULT_AGENT_ACCESS,
    computerUse: true,
    threadId: null,
    workspacePath: resolve(homedir(), "OpenBot/Agents", id),
    preview: "No messages yet",
    updatedAt: null,
    avatarSeed: seed,
    avatarHue: null,
    avatarUrl: null,
  };
}

const storedAttachmentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    size: z.number(),
    kind: z.literal("file"),
    mimeType: z.literal(MIME),
    previewKind: z.literal("none"),
    previewUrl: z.string(),
    path: z.string(),
    sha256: z.string(),
    ownerAgentId: z.string(),
    ownerThreadId: z.string(),
  })
  .strict();

// Validate every file that mailbox deletion can remove, including its containing directory.
// Pending store writes may have committed before the process could record the returned ID.
function ownedAttachments(agents: AgentStore, journal: Journal) {
  assert.ok(journal.agentId);
  const state = z.object({ generatedAttachments: z.array(z.unknown()) }).parse(agents.database.readMailboxState());
  const items = state.generatedAttachments
    .filter((item) => z.object({ ownerAgentId: z.string().optional() }).parse(item).ownerAgentId === journal.agentId)
    .map((item) => storedAttachmentSchema.parse(item));
  const prep = journal.preparation;
  if (prep) {
    const allowedCount = prep.attachmentIds.length + (prep.pendingAttachment === null ? 0 : 1);
    assert.ok(
      items.length >= prep.attachmentIds.length && items.length <= allowedCount,
      "Unexpected fixture attachments; preserve state.",
    );
    assert.ok(
      prep.attachmentIds.every((id) => items.some((item) => item.id === id)),
      "Fixture attachment missing; preserve state.",
    );
  }
  for (const item of items) {
    const index = FILENAMES.findIndex((name) => name === item.name);
    assert.ok(index >= 0, "Unknown fixture attachment; preserve it.");
    if (prep && !prep.attachmentIds.includes(item.id))
      assert.equal(index, prep.pendingAttachment, "Unexpected pending attachment; preserve it.");
    const bytes = workbookBytes(index === 1);
    const directory = resolve(agents.sharedRoot, "Transfers/generated", item.id);
    assert.deepEqual(
      item,
      {
        id: item.id,
        name: FILENAMES[index],
        size: bytes.length,
        kind: "file",
        mimeType: MIME,
        previewKind: "none",
        previewUrl: `openbot-attachment://file/${item.id}`,
        path: resolve(directory, item.name),
        sha256: sha256(bytes),
        ownerAgentId: journal.agentId,
        ownerThreadId: stableThreadId(journal.agentId),
      },
      "Fixture attachment record changed; preserve it.",
    );
    assert.equal(realpathSync(directory), directory, "Linked attachment directory; preserve it.");
    assert.deepEqual(
      readdirSync(directory).sort(),
      [".openbot-transfer.json", item.name].sort(),
      "Unknown attachment file; preserve it.",
    );
    for (const name of readdirSync(directory)) {
      const stats = lstatSync(resolve(directory, name));
      assert.ok(stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1, "Linked attachment; preserve it.");
    }
    assert.deepEqual(readFileSync(item.path), Buffer.from(bytes), "Attachment bytes changed; preserve them.");
    const manifest = JSON.parse(readFileSync(resolve(directory, ".openbot-transfer.json"), "utf8"));
    assert.equal(new Date(manifest.createdAt).toISOString(), manifest.createdAt);
    assert.deepEqual(
      manifest,
      {
        version: 2,
        kind: "generated-attachment",
        generatedAttachmentId: item.id,
        ownerAgentId: item.ownerAgentId,
        ownerThreadId: item.ownerThreadId,
        createdAt: manifest.createdAt,
        attachments: [
          {
            id: item.id,
            name: item.name,
            relativePath: item.name,
            size: item.size,
            kind: item.kind,
            mimeType: item.mimeType,
            previewKind: item.previewKind,
            sha256: item.sha256,
          },
        ],
      },
      "Attachment manifest changed; preserve it.",
    );
  }
  if (prep) {
    const root = resolve(agents.sharedRoot, "Transfers/generated");
    const names = existsSync(root) ? readdirSync(root) : [];
    assert.ok(
      names.every((name) => prep.generatedBefore.includes(name) || items.some((item) => item.id === name)),
      "Unresolved attachment write or unknown generated file; preserve state for coordinator inspection.",
    );
  }
  return items;
}

function ownedGeneratedNames(agents: AgentStore) {
  const root = resolve(agents.sharedRoot, "Transfers/generated");
  return existsSync(root) ? readdirSync(root).sort() : [];
}

function attachmentRecords(agents: AgentStore, agentId: string) {
  return z
    .object({ generatedAttachments: z.array(z.unknown()) })
    .parse(agents.database.readMailboxState())
    .generatedAttachments.filter(
      (item) => z.object({ ownerAgentId: z.string().optional() }).parse(item).ownerAgentId === agentId,
    );
}

function checkDeletingAttachments(agents: AgentStore, journal: Journal) {
  assert.ok(journal.deletion && journal.agentId);
  const intent = journal.deletion;
  if (!intent.attachmentTrees || !intent.attachmentsHash) {
    // Old journals did not record file deletion evidence. Do not infer ownership of leftovers.
    assert.deepEqual(
      attachmentRecords(agents, journal.agentId),
      [],
      "Unresolved old attachment deletion; preserve state.",
    );
    return;
  }
  const records = attachmentRecords(agents, journal.agentId);
  assert.ok(
    records.length === 0 || sha256(JSON.stringify(records)) === intent.attachmentsHash,
    "Deleting attachment records changed; preserve them.",
  );
  for (const tree of intent.attachmentTrees) {
    const root = resolve(agents.sharedRoot, "Transfers/generated");
    assert.equal(dirname(tree.directory), root, "Unsafe attachment deletion evidence.");
    const stats = lstatSync(tree.directory, { throwIfNoEntry: false });
    if (!stats) continue;
    assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), "Linked attachment directory; preserve it.");
    assert.equal(realpathSync(tree.directory), tree.directory, "Linked attachment parent; preserve it.");
    for (const name of readdirSync(tree.directory)) {
      const path = resolve(tree.directory, name);
      const file = lstatSync(path);
      assert.ok(
        Object.hasOwn(tree.files, name) && file.isFile() && !file.isSymbolicLink() && file.nlink === 1,
        "Unexpected deleting attachment file; preserve it.",
      );
      assert.equal(sha256(readFileSync(path)), tree.files[name], "Deleting attachment changed; preserve it.");
    }
  }
}

function deletionPaths(agentId: string) {
  const expected = resolve(homedir(), "OpenBot/Agents", agentId);
  return [
    expected,
    resolve(homedir(), "OpenBot/Bots", agentId.replace(/^agent-/u, "bot-")),
    resolve(profile, "avatars/agents", agentId.replace(/^agent-/u, "bot-")),
    `${expected}.openbot-stage`,
    resolve(homedir(), "OpenBot/Bots", agentId),
    resolve(profile, "avatars/agents", agentId),
    resolve(profile, "avatars/agents", `${agentId}.openbot-stage`),
    resolve(profile, "agent-duplications", `${agentId}.pending`),
  ];
}

function assertDeletionComplete(agentId: string, threadId: string | null, agents: AgentStore) {
  for (const path of deletionPaths(agentId))
    assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined, "Fixture data remains; preserve the journal.");
  const snapshot = agents.database.readConversation(agentId, threadId);
  assert.equal(snapshot.activeTurnId, null, "Deleted fixture is active; preserve the journal.");
  assert.deepEqual(snapshot.messages, [], "Deleted fixture messages remain; preserve the journal.");
  const mailbox = z
    .object({
      generatedAttachments: z.array(z.object({ ownerAgentId: z.string().optional() })),
      deliveries: z.array(z.object({ recipientAgentId: z.string() })),
      pausedAgentIds: z.array(z.string()),
      reactions: z.array(z.object({ agentId: z.string() })),
    })
    .parse(agents.database.readMailboxState());
  assert.ok(
    !mailbox.generatedAttachments.some((item) => item.ownerAgentId === agentId) &&
      !mailbox.deliveries.some((item) => item.recipientAgentId === agentId) &&
      !mailbox.pausedAgentIds.includes(agentId) &&
      !mailbox.reactions.some((item) => item.agentId === agentId),
    "Deleted fixture mailbox data remains; preserve the journal.",
  );
}

async function main() {
  const action = process.argv[2];
  assert.ok(action === "prepare" || action === "cleanup", "Use prepare or cleanup.");
  const fault = process.argv.find((arg) => arg.startsWith("--fixture-interrupt="));
  assert.ok(
    !fault ||
      (action === "prepare" &&
        ["after-pause", "after-create", "after-thread", "after-attachment", "after-message"].some(
          (point) => fault === `--fixture-interrupt=${point}`,
        )) ||
      (action === "cleanup" &&
        [
          "--fixture-interrupt=after-resume",
          "--fixture-interrupt=after-delete",
          "--fixture-interrupt=after-workspace-remove",
        ].includes(fault)),
    "Invalid fixture interruption option.",
  );
  const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
  assert.ok(phase === "before" || phase === "after", "Pass --phase=before or --phase=after.");
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
  requireSeedProfile();
  await inactive();
  if (action === "prepare")
    assert.equal(existsSync(journalPath), false, "Fixture exists; cleanup before preparing again.");
  const journal: Journal =
    action === "cleanup"
      ? readJournal()
      : {
          version: 2,
          deletion: null,
          instance: INSTANCE,
          agentId: null,
          ready: false,
          messagesHash: null,
          fixtures: [],
          paused: [],
        };
  const save = () => {
    const temporary = `${journalPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    const descriptor = openSync(temporary, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, journalPath);
    const directory = openSync(profile, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
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
      assert.equal(
        agents.list().some((agent) => agent.description === MARKER),
        false,
        "An unjournaled fixture exists; preserve it.",
      );
      journal.fixtures = writeWorkbooks(phase);
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
      const generatedRoot = resolve(agents.sharedRoot, "Transfers/generated");
      journal.preparation = {
        creationSeed: randomUUID(),
        agentHashes: [],
        attachmentIds: [],
        pendingAttachment: null,
        generatedBefore: existsSync(generatedRoot) ? readdirSync(generatedRoot) : [],
        workspacesBefore: readdirSync(resolve(homedir(), "OpenBot/Agents")),
        messageHashes: [sha256(JSON.stringify([]))],
      };
      save();
      const prep = journal.preparation;
      let agent = await runCauseEffect(
        agents.createAgent({ name: FIXTURE_NAME, description: MARKER, avatarSeed: prep.creationSeed, avatarHue: null }),
      );
      // Creation uses a saved nonce plus the exact store defaults, even if this save never runs.
      interrupt("after-create");
      assert.deepEqual(agent, initialAgent(agent.id, prep.creationSeed));
      journal.agentId = agent.id;
      prep.agentHashes = [agentFingerprint(agent)];
      save();
      const threadId = stableThreadId(agent.id);
      const threaded = { ...agent, threadId, updatedAt: new Date().toISOString() };
      prep.agentHashes.push(agentFingerprint(threaded));
      save();
      // ensureThreadId mints its clock inside the mutation. Use the same real roster persistence
      // boundary with a pre-recorded clock so both sides of an interrupted write have exact hashes.
      agents.database.replaceAgents(
        `${MARKER}.thread.${agent.id}`,
        agents.list().map((entry) => (entry.id === agent.id ? threaded : entry)),
        "thread.created",
      );
      interrupt("after-thread");
      agent = threaded;
      prep.agentHashes = [agentFingerprint(agent)];
      save();
      const attachments = [];
      for (const [index, name] of FILENAMES.entries()) {
        prep.pendingAttachment = index;
        save();
        const attachment = await runCauseEffect(
          mailbox.storeGeneratedAttachment({
            name,
            mimeType: MIME,
            bytes: workbookBytes(index === 1),
            ownerAgentId: agent.id,
            ownerThreadId: threadId,
          }),
        );
        interrupt("after-attachment");
        attachments.push(attachment);
        prep.attachmentIds.push(attachment.id);
        prep.pendingAttachment = null;
        save();
      }
      const messages: ConversationMessage[] = [
        {
          id: MARKER,
          author: "assistant",
          status: "completed",
          text: FIXTURE_TEXT,
          createdAt: new Date().toISOString(),
          attachments,
        },
      ];
      const expectedHash = sha256(JSON.stringify(messages));
      prep.messageHashes.push(expectedHash);
      save();
      agents.database.persistConversation(
        { agentId: agent.id, threadId, activeTurnId: null, revision: 0, messages },
        `${MARKER}.created`,
      );
      interrupt("after-message");
      journal.messagesHash = expectedHash;
      prep.messageHashes = [expectedHash];
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
      if (!journal.agentId && journal.preparation) {
        const candidates = agents.list().filter((entry) => entry.avatarSeed === journal.preparation?.creationSeed);
        assert.ok(candidates.length <= 1, "Ambiguous fixture creation; preserve state.");
        const created = candidates[0];
        if (created) {
          assert.deepEqual(
            created,
            initialAgent(created.id, journal.preparation.creationSeed),
            "Incomplete fixture identity changed; preserve it.",
          );
          assertOwnedWorkspace(created.id, created.workspacePath);
          journal.agentId = created.id;
          journal.preparation.agentHashes = [agentFingerprint(created)];
          save();
        } else {
          assert.deepEqual(
            readdirSync(resolve(homedir(), "OpenBot/Agents")).sort(),
            [...journal.preparation.workspacesBefore].sort(),
            "Unresolved workspace creation; preserve journal for coordinator inspection.",
          );
          assert.deepEqual(
            ownedGeneratedNames(agents),
            [...journal.preparation.generatedBefore].sort(),
            "Unresolved attachment creation; preserve journal.",
          );
        }
      }
      if (journal.agentId) {
        const agent = agents.list().find((entry) => entry.id === journal.agentId);
        if (agent) {
          assert.equal(agent.name, FIXTURE_NAME, "Fixture agent changed; preserve it.");
          assert.equal(agent.description, MARKER, "Fixture agent changed; preserve it.");
          if (journal.preparation)
            assert.ok(
              journal.preparation.agentHashes.includes(agentFingerprint(agent)),
              "Fixture identity or configuration changed; preserve it.",
            );
          const snapshot = agents.database.readConversation(agent.id, agent.threadId);
          assert.equal(snapshot.activeTurnId, null, "Fixture agent is active.");
          assert.ok(
            (journal.preparation?.messageHashes ?? [journal.messagesHash]).includes(
              preparedMessagesHash(snapshot.messages),
            ),
            "Fixture messages changed; preserve them.",
          );
          assertOwnedWorkspace(agent.id, agent.workspacePath, Boolean(journal.deletion));
          // After mailbox deletion committed, its records and files may already be absent.
          const attachments = journal.deletion ? null : ownedAttachments(agents, journal);
          if (journal.deletion) checkDeletingAttachments(agents, journal);
          const agentHash = sha256(JSON.stringify(agent));
          if (journal.deletion) {
            assert.equal(journal.deletion.agentHash, agentHash, "Deleting agent changed; preserve it.");
            assert.equal(journal.deletion.threadId, agent.threadId, "Deleting thread changed; preserve it.");
          } else {
            assert.ok(attachments);
            journal.deletion = {
              agentHash,
              threadId: agent.threadId,
              attachmentsHash: sha256(JSON.stringify(attachmentRecords(agents, agent.id))),
              attachmentTrees: attachments.map((item) => ({
                directory: dirname(item.path),
                files: Object.fromEntries(
                  readdirSync(dirname(item.path)).map((name) => [
                    name,
                    sha256(readFileSync(resolve(dirname(item.path), name))),
                  ]),
                ),
              })),
            };
            save();
          }
          await runCauseEffect(mailbox.deleteAgentData(agent.id));
          if (fault === "--fixture-interrupt=after-workspace-remove") {
            // Harness-only staging of the real deleteAgent filesystem-before-database boundary.
            // Every path and byte was checked above; never enable this in product code.
            assertOwnedWorkspace(agent.id, agent.workspacePath, true);
            rmSync(agent.workspacePath, { recursive: true });
            interrupt("after-workspace-remove");
          }
          await runCauseEffect(agents.deleteAgent(agent.id));
          interrupt("after-delete");
        } else {
          assert.ok(journal.deletion, "Fixture agent is missing without deletion intent; preserve the journal.");
          checkDeletingAttachments(agents, journal);
          assertDeletionComplete(journal.agentId, journal.deletion.threadId, agents);
          for (const tree of journal.deletion.attachmentTrees ?? [])
            assert.equal(
              lstatSync(tree.directory, { throwIfNoEntry: false }),
              undefined,
              "Deleted attachment directory remains; preserve journal.",
            );
        }
        journal.agentId = null;
        journal.deletion = null;
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
