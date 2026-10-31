// Run: bun scripts/transfer-skill-pack-e2e.ts
// Report: .openbot-build/transfer-skill-pack-e2e.json
// Installs a skill pack with more skills than an agent can have, exports the agent with the real
// transfer service, and imports it through the real local skill library and pack installer.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentSummary, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import { zipSync } from "fflate";
import { CentralAuthOperationError } from "../src/main/central-auth-effects";
import { CentralAuthManager } from "../src/main/central-auth-manager";
import { type InstanceTransferOptions, InstanceTransferService } from "../src/main/instance-transfer-service";
import { LocalSkillLibrary } from "../src/main/local-skill-library";
import { SkillMarketplaceService } from "../src/main/skill-marketplace-service";

const run = Effect.runPromise;
const root = await mkdtemp(join(tmpdir(), "openbot-transfer-pack-"));
const reportPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".openbot-build",
  "transfer-skill-pack-e2e.json",
);
interface Report {
  status: "running" | "pass" | "fail";
  summarySkillCount?: number | undefined;
  exportWarnings?: string[];
  importWarnings?: string[];
  sourceLock?: Array<{ slug: string; folders: number }>;
  importedLock?: Array<{ slug: string; folders: number }>;
  skillFiles?: { source: number; imported: number };
  reason?: string;
}
const report: Report = { status: "running" };

const text = (value: string) => new TextEncoder().encode(value);
const skillMarkdown = (name: string) => text(`---\nname: ${name}\ndescription: Test ${name}.\n---\nUse ${name}.\n`);
// More skills than an agent can have, so the export cut the pack before the fix.
const children = Array.from({ length: INPUT_LIMITS.agentSkills + 8 }, (_, index) => `kit-skill-${index + 1}`);
const packFiles: Record<string, Uint8Array> = {
  "SKILL.md": skillMarkdown("kit"),
  LICENSE: text("Test license.\n"),
  ...Object.fromEntries(children.map((child) => [`skills/${child}/SKILL.md`, skillMarkdown(child)])),
};
const bundle = zipSync(packFiles);
const detail: MarketplaceSkillDetail = {
  id: "kit-pack",
  versionId: "kit-pack-version-1",
  slug: "kit",
  name: "kit",
  description: "Test kit.",
  category: "coding",
  creatorName: "Test Author",
  creatorAvatarUrl: null,
  version: 1,
  installs: 0,
  featured: false,
  iconUrl: null,
  updatedAt: "2026-10-30T00:00:00.000Z",
  instructions: "Use kit.",
  files: Object.keys(packFiles),
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
};

class CatalogAuth extends CentralAuthManager {
  override requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decode: (value: unknown) => T,
  ): Effect.Effect<T, CentralAuthOperationError> {
    if (init.method === "GET" && path === `/v1/skills/${detail.id}`) return Effect.succeed(decode(detail));
    if (init.method === "POST" && path === `/v1/skills/${detail.id}/install`)
      return Effect.succeed(decode({ installed: true }));
    return Effect.fail(new CentralAuthOperationError({ cause: "unexpected request" }));
  }

  override readonly downloadAuthorized = (path: string): Effect.Effect<Uint8Array, CentralAuthOperationError> =>
    path === `/v1/skills/${detail.id}/content`
      ? Effect.succeed(bundle)
      : Effect.fail(new CentralAuthOperationError({ cause: "unexpected download" }));
}

function agentSummary(id: string, name: string): AgentSummary {
  return {
    id,
    name,
    title: "",
    description: "",
    notifications: false,
    provider: "codex",
    model: "gpt-5",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: join(root, "agents", id),
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

/** Each file in `.agents/skills`, with its text, by path. An install also copies it to `.claude/skills`. */
async function skillTree(workspace: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else tree[relative(workspace, path)] = await readFile(path, "utf8");
    }
  };
  await visit(join(workspace, ".agents/skills"));
  return tree;
}

const decodeLock = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      skills: Schema.Record(
        Schema.String,
        Schema.Struct({ slug: Schema.String, folders: Schema.optionalKey(Schema.Array(Schema.String)) }),
      ),
    }),
  ),
);

async function lockedFolders(workspace: string): Promise<Array<{ slug: string; folders: number }>> {
  const lock = decodeLock(await readFile(join(workspace, ".openbot", "skills-lock.json"), "utf8"));
  return Object.values(lock.skills)
    .map((entry) => ({ slug: entry.slug, folders: entry.folders?.length ?? 0 }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

try {
  const source = agentSummary("agent-source", "Source");
  const agents: AgentSummary[] = [source];
  await mkdir(source.workspacePath, { recursive: true });
  const library = new LocalSkillLibrary(join(root, "local-skills"), () => agents);
  const skills = new SkillMarketplaceService(
    new CatalogAuth({
      apiUrl: "https://example.invalid",
      storagePath: join(root, "auth.json"),
      canPersist: () => false,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    }),
    () => agents,
    () => Effect.void,
    library,
  );
  await run(skills.install({ agentId: source.id, skillId: detail.id }));
  // A skill a user put in the folder without OpenBot travels as a skill of its own.
  await mkdir(join(source.workspacePath, ".agents/skills/notes"), { recursive: true });
  await writeFile(join(source.workspacePath, ".agents/skills/notes/SKILL.md"), skillMarkdown("notes"));

  const transferAgents: InstanceTransferOptions["agents"] = {
    listAgents: () => agents,
    listRoutines: () => [],
    listMemories: () => [],
    getMemorySelection: () => ({ selections: [] }),
    setMemoryInclusion: () => undefined,
    resolveAvatar: () => null,
    listModels: () => [{ provider: "codex", id: "gpt-5" }],
    createAgentProfile: (input) =>
      Effect.promise(async () => {
        const created = agentSummary(`agent-imported-${agents.length}`, input.name);
        await mkdir(created.workspacePath, { recursive: true });
        agents.push(created);
        return created;
      }),
    updateAgent: (input) =>
      Effect.sync(() => {
        const agent = agents.find((item) => item.id === input.agentId);
        assert.ok(agent);
        return agent;
      }),
    createRoutine: () => {
      throw new Error("The agent has no routines.");
    },
    createMemory: () => {
      throw new Error("The agent has no memories.");
    },
    memoryLimit: () => 0,
    initializeMemorySelection: () => undefined,
    setAvatar: () => Effect.die("The agent has no avatar."),
    deleteAgent: () => Effect.die("A successful import deletes no agent."),
  };
  const transfer = new InstanceTransferService({
    agents: transferAgents,
    skills: { library: () => library, installLocal: (input) => skills.installLocal(input) },
    settings: {
      mcpServers: () => [],
      saveMcpServer: () => Effect.void,
      customProviders: () => [],
      saveCustomProvider: () => Effect.void,
      customAgents: () => Effect.succeed([]),
      providersOff: () => [],
      sidebar: () => {
        throw new Error("Settings are not imported.");
      },
      mutateSidebar: () => Effect.die("Settings are not imported."),
      routineFlowLinks: () => Effect.succeed([]),
      connectRoutineFlow: () => Effect.void,
      signedInProviders: () => [],
    },
    sharedRoot: join(root, "shared"),
    appVersion: "e2e",
    timezone: () => "UTC",
  });

  const summary = await run(transfer.summary());
  report.summarySkillCount = summary.agents[0]?.skillCount;
  assert.equal(report.summarySkillCount, 2, "The pack counts as one skill.");

  const file = join(root, "transfer.zip");
  const exported = await run(
    transfer.exportTo(file, { agentIds: [source.id], includeFiles: false, includeSettings: false }),
  );
  report.exportWarnings = exported.warnings;
  assert.deepEqual(exported.warnings, [], "The export keeps every skill.");

  const preview = await run(transfer.stage(file));
  const imported = await run(
    transfer.apply({ token: preview.token, keys: preview.agents.map((agent) => agent.key), includeSettings: false }),
  );
  report.importWarnings = imported.warnings;
  const copy = agents.find((agent) => agent.id === imported.agents[0]?.id);
  assert.ok(copy, "The import creates the agent.");

  report.sourceLock = await lockedFolders(source.workspacePath);
  report.importedLock = await lockedFolders(copy.workspacePath);
  assert.deepEqual(report.importedLock, [
    { slug: "kit", folders: children.length },
    { slug: "notes", folders: 0 },
  ]);
  const sourceTree = await skillTree(source.workspacePath);
  const importedTree = await skillTree(copy.workspacePath);
  report.skillFiles = { source: Object.keys(sourceTree).length, imported: Object.keys(importedTree).length };
  assert.deepEqual(importedTree, sourceTree, "The imported agent has the same skill folders and files.");
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.reason = error instanceof assert.AssertionError ? error.message : "An operation failed.";
  process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
