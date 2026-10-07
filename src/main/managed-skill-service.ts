import { lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import type { AgentSummary, InstalledSkill } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import { causeHelpers } from "../backend/effect-boundary";
import { isMissingFileError } from "../backend/file-errors";
import { isPathInside } from "../backend/path-containment";

const MANAGED_SKILL_SLUG = "openbot-site-hosting";
export const OWNERSHIP_MARKER = ".openbot-managed.json";
/** The workspace skill folders OpenBot writes. Each provider reads at least one of them. */
export const MANAGED_SKILL_FOLDERS = [".agents/skills", ".claude/skills"] as const;

const logger = createOpenBotLogger("managed-skill-service");

interface SyncTargetsResult {
  collisions: string[];
  failures: { target: string; error: unknown }[];
}

export class ManagedSkillService {
  #content: string | null = null;

  constructor(
    private readonly sourcePath: string,
    private readonly reportCollision: (target: string) => void = (target) => {
      logger.warn(`OpenBot preserved an unowned managed-skill collision at ${target}.`);
    },
    private readonly reportFailure: (target: string, error: unknown) => void = (target, error) => {
      logger.error(`OpenBot could not synchronize the managed skill at ${target}.`, toLogValue(error));
    },
    private readonly slug = MANAGED_SKILL_SLUG,
  ) {}

  syncAll(agents: AgentSummary[]): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const content = yield* Effect.result(this.content());
      if (Result.isFailure(content)) {
        this.reportFailure(this.sourcePath, content.failure.cause);
        return;
      }
      const results = yield* Effect.forEach(
        agents,
        (agent) => Effect.result(syncTargets(agent.workspacePath, content.success, this.slug)),
        { concurrency: "unbounded" },
      );
      for (const [index, result] of results.entries()) {
        if (Result.isSuccess(result)) this.reportResult(result.success);
        else this.reportFailure(agents[index]?.workspacePath ?? "unknown workspace", result.failure.cause);
      }
    });
  }

  syncAgent(agent: AgentSummary): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const result = yield* Effect.result(
        this.content().pipe(Effect.flatMap((content) => syncTargets(agent.workspacePath, content, this.slug))),
      );
      if (Result.isSuccess(result)) this.reportResult(result.success);
      else this.reportFailure(agent.workspacePath, result.failure.cause);
    });
  }

  private content(): Effect.Effect<string, ManagedSkillFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#content !== null) return this.#content;
      const content = yield* managedIO(() => readFile(this.sourcePath, "utf8"));
      if (!content.startsWith(`---\nname: ${this.slug}\n`))
        return yield* new ManagedSkillFailure({ cause: new Error("The managed site hosting skill is invalid.") });
      this.#content = content;
      return content;
    });
  }

  private reportResult(result: SyncTargetsResult): void {
    for (const target of result.collisions) this.reportCollision(target);
    for (const failure of result.failures) this.reportFailure(failure.target, failure.error);
  }
}

const syncTargets = Effect.fn("ManagedSkill.syncTargets")(function* (
  workspacePath: string,
  content: string,
  slug: string,
) {
  const workspaceRoot = yield* managedIO(() => realpath(resolve(workspacePath)));
  const targets = MANAGED_SKILL_FOLDERS.map((folder) => join(workspacePath, folder, slug, "SKILL.md"));
  const resolvedTargets = MANAGED_SKILL_FOLDERS.map((folder) => join(workspaceRoot, folder, slug, "SKILL.md"));
  const results = yield* Effect.forEach(
    resolvedTargets,
    (target) => Effect.result(syncTarget(workspaceRoot, target, content, slug)),
    { concurrency: "unbounded" },
  );
  const collisions: string[] = [];
  const failures: SyncTargetsResult["failures"] = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const target = targets[index];
    if (!result || !target) continue;
    if (Result.isFailure(result)) failures.push({ target, error: result.failure.cause });
    else if (result.success === "collision") collisions.push(target);
  }
  return { collisions, failures };
});

const syncTarget = Effect.fn("ManagedSkill.syncTarget")(function* (
  workspaceRoot: string,
  target: string,
  content: string,
  slug: string,
): Effect.fn.Return<"synced" | "collision", ManagedSkillFailure> {
  const ownershipContent = `${JSON.stringify({ managedBy: "openbot", slug, version: 1 })}\n`;
  const parent = dirname(target);
  yield* ensureSafeDirectory(workspaceRoot, parent);
  const marker = join(parent, OWNERSHIP_MARKER);
  yield* rejectSymlink(target);
  yield* rejectSymlink(marker);
  if (yield* fileExists(target)) {
    if ((yield* optionalText(marker)) !== ownershipContent) return "collision";
    yield* atomicWrite(workspaceRoot, target, content);
    return "synced";
  }
  const written = yield* Effect.result(
    verifySafeDirectory(workspaceRoot, parent).pipe(
      Effect.andThen(managedIO(() => writeFile(target, content, { encoding: "utf8", mode: 0o600, flag: "wx" }))),
    ),
  );
  if (Result.isFailure(written)) {
    if (isFileExistsError(written.failure.cause)) return "collision";
    return yield* written.failure;
  }
  const ownership = yield* Effect.result(atomicWrite(workspaceRoot, marker, ownershipContent));
  if (Result.isFailure(ownership)) {
    yield* verifySafeDirectory(workspaceRoot, parent).pipe(
      Effect.andThen(managedIO(() => unlink(target))),
      Effect.catch(() => Effect.void),
    );
    return yield* ownership.failure;
  }
  return "synced";
}, Effect.uninterruptible);

const atomicWrite = Effect.fn("ManagedSkill.atomicWrite")(function* (
  workspaceRoot: string,
  target: string,
  content: string,
) {
  const parent = dirname(target);
  yield* verifySafeDirectory(workspaceRoot, parent);
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  yield* managedIO(() => writeFile(temporary, content, { encoding: "utf8", mode: 0o600 }));
  return yield* verifySafeDirectory(workspaceRoot, parent).pipe(
    Effect.andThen(managedIO(() => rename(temporary, target))),
    Effect.ensuring(managedIO(() => unlink(temporary)).pipe(Effect.catch(() => Effect.void))),
  );
});

const ensureSafeDirectory = Effect.fn("ManagedSkill.ensureDirectory")(function* (
  workspaceRoot: string,
  directory: string,
) {
  const path = yield* managedSync(() => containedRelativePath(workspaceRoot, directory));
  let current = workspaceRoot;
  for (const segment of path.split(sep).filter(Boolean)) {
    current = join(current, segment);
    const created = yield* Effect.result(managedIO(() => mkdir(current, { mode: 0o700 })));
    if (Result.isFailure(created) && !isFileExistsError(created.failure.cause)) return yield* created.failure;
    yield* requireRealDirectory(current);
  }
  yield* verifySafeDirectory(workspaceRoot, directory);
});

const verifySafeDirectory = Effect.fn("ManagedSkill.verifyDirectory")(function* (
  workspaceRoot: string,
  directory: string,
) {
  const path = yield* managedSync(() => containedRelativePath(workspaceRoot, directory));
  yield* requireRealDirectory(workspaceRoot);
  let current = workspaceRoot;
  for (const segment of path.split(sep).filter(Boolean)) {
    current = join(current, segment);
    yield* requireRealDirectory(current);
  }
  const resolvedDirectory = yield* managedIO(() => realpath(directory));
  if (!isPathInside(workspaceRoot, resolvedDirectory))
    return yield* new ManagedSkillFailure({
      cause: new Error(`Managed skill target escapes its workspace: ${directory}`),
    });
});

function containedRelativePath(workspaceRoot: string, candidate: string): string {
  if (!isPathInside(workspaceRoot, candidate)) {
    throw new Error(`Managed skill target escapes its workspace: ${candidate}`);
  }
  return relative(workspaceRoot, candidate);
}

const requireRealDirectory = Effect.fn("ManagedSkill.requireDirectory")(function* (path: string) {
  const stats = yield* managedIO(() => lstat(path));
  if (stats.isSymbolicLink() || !stats.isDirectory())
    return yield* new ManagedSkillFailure({ cause: new Error(`Managed skill path must be a real directory: ${path}`) });
});
const rejectSymlink = Effect.fn("ManagedSkill.rejectSymlink")(function* (path: string) {
  const result = yield* Effect.result(managedIO(() => lstat(path)));
  if (Result.isFailure(result)) {
    if (isMissingFileError(result.failure.cause)) return;
    return yield* result.failure;
  }
  if (result.success.isSymbolicLink())
    return yield* new ManagedSkillFailure({ cause: new Error(`Managed skill path cannot be a symlink: ${path}`) });
});
const fileExists = Effect.fn("ManagedSkill.fileExists")((path: string) =>
  managedIO(() => lstat(path)).pipe(
    Effect.as(true),
    Effect.catch((error) => (isMissingFileError(error.cause) ? Effect.succeed(false) : Effect.fail(error))),
  ),
);
const optionalText = Effect.fn("ManagedSkill.optionalText")((path: string) =>
  managedIO(() => readFile(path, "utf8")).pipe(
    Effect.catch((error) => (isMissingFileError(error.cause) ? Effect.succeed(null) : Effect.fail(error))),
  ),
);

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** Read only OpenBot-owned skills from the active provider's skill folder. */
export const listManagedSkillsForChat = Effect.fn("ManagedSkill.listForChat")(function* (agent: AgentSummary) {
  const root = yield* managedIO(() => realpath(agent.workspacePath));
  const reads = agentProviderDescriptor(agent.provider).skillFolders;
  const directory = join(root, MANAGED_SKILL_FOLDERS.find((folder) => reads.includes(folder)) ?? reads[0]);
  const skills: InstalledSkill[] = [];
  yield* Effect.gen(function* () {
    yield* verifySafeDirectory(root, directory);
    for (const entry of yield* managedIO(() => readdir(directory, { withFileTypes: true }))) {
      if (!entry.isDirectory()) continue;
      yield* Effect.gen(function* () {
        const folder = join(directory, entry.name);
        yield* verifySafeDirectory(root, folder);
        const marker = join(folder, OWNERSHIP_MARKER);
        const file = join(folder, "SKILL.md");
        yield* rejectSymlink(marker);
        yield* rejectSymlink(file);
        if (
          (yield* optionalText(marker)) !==
          `${JSON.stringify({ managedBy: "openbot", slug: entry.name, version: 1 })}\n`
        )
          return;
        const content = yield* managedIO(() => readFile(file, "utf8"));
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];
        if (!frontmatter) return;
        const metadata = yield* managedSync(() => parseYaml(frontmatter));
        if (!isDynamicRecord(metadata) || metadata.name !== entry.name || typeof metadata.description !== "string")
          return;
        skills.push({
          skillId: entry.name,
          slug: entry.name,
          name: entry.name,
          description: metadata.description,
          installedVersion: 1,
          availableVersion: 1,
          enabled: true,
          state: "installed",
          origin: "managed",
        });
      }).pipe(Effect.catch(() => Effect.void));
    }
  }).pipe(Effect.catch(() => Effect.void));
  return skills;
});

class ManagedSkillFailure extends Schema.TaggedError<ManagedSkillFailure>()("ManagedSkillFailure", {
  cause: Schema.Defect(),
}) {}

const { io: managedIO, sync: managedSync } = causeHelpers(ManagedSkillFailure);
