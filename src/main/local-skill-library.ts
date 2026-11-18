import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentSummary, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { zipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { causeHelpers } from "../backend/effect-boundary";
import { MANAGED_SKILL_SLUGS } from "./managed-skill-service";
import {
  archiveDirectory,
  inspectArchive,
  normalizedFiles,
  readSkillArchive,
  SKILL_FRONTMATTER,
  skillZippable,
} from "./skill-package";

/** Owns immutable local revisions. A revision exists only after its directory is published. */
export class LocalSkillLibrary {
  readonly #writes = Semaphore.makeUnsafe(1);
  constructor(
    readonly root: string,
    private readonly agents: () => AgentSummary[],
  ) {}

  list(): Effect.Effect<MarketplaceSkillDetail[], LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceSkillDetail[], LocalSkillFailure> {
      yield* localIO(() => mkdir(this.root, { recursive: true, mode: 0o700 }));
      const entries = yield* localIO(() => readdir(this.root, { withFileTypes: true }));
      const published = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^local-skill-[\da-f-]{36}$/u.test(entry.name)) continue;
        const revisions = yield* localIO(() => readdir(join(this.root, entry.name)));
        if (revisions.some((name) => /^[1-9]\d*$/u.test(name))) published.push(entry.name);
      }
      const results = yield* Effect.forEach(published, (id) => this.get(id), { concurrency: "unbounded" });
      // An older version took a skill with the name of an OpenBot skill. It can never install, so it stays hidden.
      return results
        .filter((skill) => !MANAGED_SKILL_SLUGS.has(skill.slug))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  private directory(id: string): string {
    if (!/^local-skill-[\da-f-]{36}$/u.test(id)) throw new Error("Invalid local skill ID.");
    return join(this.root, id);
  }

  /**
   * The requested revision, or the latest when none is requested. A skill or revision that the library
   * does not have fails with text that names it, so an agent can correct its call (#7193).
   */
  private revision(id: string, requested?: number): Effect.Effect<number, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<number, LocalSkillFailure> {
      if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 1))
        return yield* new LocalSkillFailure({ cause: new Error("Invalid skill revision.") });
      const revisions = yield* this.revisions(id);
      if (!revisions.length)
        return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localNoRevisions")) });
      const latest = Math.max(...revisions);
      if (requested === undefined) return latest;
      if (!revisions.includes(requested))
        return yield* new LocalSkillFailure({
          cause: new Error(
            sourceText("error.skill.localRevisionNotFound", { revision: String(requested), latest: String(latest) }),
          ),
        });
      return requested;
    });
  }

  /** Every saved revision of a skill. */
  revisions(id: string): Effect.Effect<number[], LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<number[], LocalSkillFailure> {
      const listed = yield* Effect.result(localIO(() => readdir(this.directory(id), { withFileTypes: true })));
      if (Result.isFailure(listed)) {
        const error = listed.failure.cause;
        if (isDynamicRecord(error) && error.code === "ENOENT")
          return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localNotFound")) });
        return yield* listed.failure;
      }
      return listed.success
        .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/u.test(entry.name))
        .map((entry) => Number(entry.name));
    });
  }

  bundle(id: string, revision: number): Effect.Effect<Uint8Array, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<Uint8Array, LocalSkillFailure> {
      const directory = yield* localSync(() => this.directory(id));
      const path = join(directory, String(yield* this.revision(id, revision)), "bundle.zip");
      yield* rejectLinks(this.root, path);
      return new Uint8Array(yield* localIO(() => readFile(path)));
    });
  }

  get(id: string, requested?: number): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceSkillDetail, LocalSkillFailure> {
      const revision = yield* this.revision(id, requested);
      const bytes = yield* this.bundle(id, revision);
      const info = yield* localSync(() => inspectArchive(bytes));
      const files = yield* localSync(() => normalizedFiles(bytes));
      const text = new TextDecoder().decode(files["SKILL.md"]);
      const match = text.match(SKILL_FRONTMATTER);
      const metadata = yield* localSync(() => parseYaml(match?.[1] ?? ""));
      const example =
        isDynamicRecord(metadata) && isString(metadata["example-prompt"]) ? metadata["example-prompt"].trim() : "";
      const icon = files["assets/icon.png"];
      const iconUrl =
        icon && icon.byteLength <= 512 * 1024 && Buffer.from(icon.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a"
          ? `data:image/png;base64,${Buffer.from(icon).toString("base64")}`
          : null;
      return {
        ...info,
        id,
        version: revision,
        versionId: String(revision),
        category: "other",
        creatorName: "Local",
        installs: 0,
        featured: false,
        iconUrl,
        updatedAt: (yield* localIO(() => stat(join(this.directory(id), String(revision))))).mtime.toISOString(),
        bundleSha256: createHash("sha256").update(bytes).digest("hex"),
        instructions: text.slice(match?.[0].length ?? 0).trim(),
        ...(example && example.length <= 1000 ? { examplePrompt: example } : {}),
      };
    });
  }

  create(agentId: string, sourcePath: string): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return this.serialize(
      Effect.gen({ self: this }, function* () {
        return yield* this.publishNew(yield* this.sourceEffect(agentId, sourcePath));
      }),
    );
  }

  /** Saves a new skill from a bundle that OpenBot built, as the memory review does when it learns one. */
  createFromBundle(bytes: Uint8Array): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return this.serialize(Effect.suspend(() => this.publishNew(bytes)));
  }

  revise(
    agentId: string,
    id: string,
    expectedRevision: number,
    sourcePath: string,
  ): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return this.serialize(
      Effect.gen({ self: this }, function* () {
        const current = yield* this.currentAt(id, expectedRevision);
        return yield* this.publishNext(current, yield* this.sourceEffect(agentId, sourcePath));
      }),
    );
  }

  /** Saves the next revision from a bundle that OpenBot built, as the memory review does when it learns. */
  reviseFromBundle(
    id: string,
    expectedRevision: number,
    bytes: Uint8Array,
  ): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return this.serialize(
      Effect.gen({ self: this }, function* () {
        return yield* this.publishNext(yield* this.currentAt(id, expectedRevision), bytes);
      }),
    );
  }

  private publishNew(bytes: Uint8Array): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* () {
      const info = yield* localSync(() => inspectArchive(bytes));
      if (MANAGED_SKILL_SLUGS.has(info.slug))
        return yield* new LocalSkillFailure({
          cause: new Error(sourceText("error.skill.managedSlug", { slug: info.slug })),
        });
      const taken = (yield* this.list()).find((skill) => skill.slug === info.slug);
      // A different name can give the same slug, as two names that differ only in Chinese text do (#8693).
      if (taken)
        return yield* new LocalSkillFailure({
          cause: new Error(
            taken.name === info.name
              ? sourceText("error.skill.localNameTaken")
              : sourceText("error.skill.localNameClash", { name: taken.name, slug: info.slug }),
          ),
        });
      const id = `local-skill-${randomUUID()}`;
      yield* this.publishEffect(id, 1, bytes);
      return yield* this.get(id, 1);
    });
  }

  private currentAt(id: string, expectedRevision: number): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* () {
      const current = yield* this.get(id);
      if (current.version !== expectedRevision)
        return yield* new LocalSkillFailure({
          cause: new Error("The skill changed. Read its latest revision before revising it."),
        });
      return current;
    });
  }

  private publishNext(
    current: MarketplaceSkillDetail,
    bytes: Uint8Array,
  ): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* () {
      if ((yield* localSync(() => inspectArchive(bytes))).slug !== current.slug)
        return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localKeepName")) });
      yield* this.publishEffect(current.id, current.version + 1, bytes);
      return yield* this.get(current.id, current.version + 1);
    });
  }

  /** Removes a revision a failed import published. A skill left with no revision is removed too. */
  withdraw(id: string, revision: number): Effect.Effect<void, LocalSkillFailure> {
    return this.serialize(
      Effect.gen({ self: this }, function* () {
        const directory = yield* localSync(() => this.directory(id));
        const path = join(directory, String(yield* this.revision(id, revision)));
        yield* rejectLinks(this.root, path);
        yield* localIO(() => rm(path, { recursive: true, force: true }));
        if (!(yield* localIO(() => readdir(directory))).some((name) => /^[1-9]\d*$/u.test(name)))
          yield* localIO(() => rm(directory, { recursive: true, force: true }));
      }),
    );
  }

  private sourceEffect(agentId: string, sourcePath: string): Effect.Effect<Uint8Array, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<Uint8Array, LocalSkillFailure> {
      const agent = this.agents().find((item) => item.id === agentId);
      if (!agent) return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.chooseLocalAgent")) });
      if (
        !sourcePath ||
        isAbsolute(sourcePath) ||
        sourcePath.includes("\\") ||
        sourcePath.split("/").some((part) => part === ".." || !part)
      )
        return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localRelativeFolder")) });
      const root = yield* localIO(() => realpath(agent.workspacePath));
      const path = resolve(root, sourcePath);
      if (!path.startsWith(`${root}${sep}`))
        return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localSourceOutside")) });
      yield* rejectLinks(root, path);
      if (!(yield* localIO(() => lstat(path))).isDirectory())
        return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localSourceNotFolder")) });
      if (!(yield* localIO(() => lstat(join(path, "SKILL.md")))).isFile())
        return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localMissingSkillFile")) });
      const archived = yield* archiveDirectory(path).pipe(
        Effect.mapError(({ cause }) => new LocalSkillFailure({ cause })),
      );
      const bytes = yield* localSync(() => withQuotedFrontmatter(archived));
      yield* localSync(() => inspectArchive(bytes));
      return bytes;
    });
  }

  private publishEffect(id: string, revision: number, bytes: Uint8Array): Effect.Effect<void, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, LocalSkillFailure> {
      yield* localIO(() => mkdir(this.root, { recursive: true, mode: 0o700 }));
      const directory = yield* localSync(() => this.directory(id));
      yield* localIO(() => mkdir(directory, { recursive: true, mode: 0o700 }));
      yield* rejectLinks(this.root, directory);
      const stage = join(directory, `.stage-${randomUUID()}`);
      yield* localIO(() => mkdir(stage, { mode: 0o700 }));
      yield* Effect.gen({ self: this }, function* () {
        yield* localIO(() => writeFile(join(stage, "bundle.zip"), bytes, { mode: 0o600, flag: "wx" }));
        yield* localIO(() => rename(stage, join(directory, String(revision))));
      }).pipe(
        Effect.ensuring(
          Effect.gen({ self: this }, function* () {
            yield* localIO(() => rm(stage, { recursive: true, force: true }));
          }).pipe(Effect.orDie),
        ),
      );
    });
  }

  private serialize<A>(operation: Effect.Effect<A, LocalSkillFailure>): Effect.Effect<A, LocalSkillFailure> {
    return this.#writes.withPermit(Effect.uninterruptible(operation));
  }
}

/** A top-level `key: value` line. */
const TOP_LEVEL_VALUE = /^([A-Za-z][\w-]*):[ \t]+(\S.*)$/u;
/** The first character of a value that is not plain YAML text. */
const NOT_PLAIN = /^["'|>[{&*!%@`#]/u;

function parsesAsYaml(text: string): boolean {
  try {
    parseYaml(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * An agent often writes `description: Use when: ...`, which YAML refuses. When the frontmatter of the
 * `SKILL.md` in `bytes` does not parse, each top-level plain value with a colon gets quotes. When it
 * then parses, the bundle has the quoted `SKILL.md`; otherwise it is unchanged and fails as before.
 * The folder in the workspace does not change.
 */
function withQuotedFrontmatter(bytes: Uint8Array): Uint8Array {
  const { files, executable } = readSkillArchive(bytes);
  const skillFile = files["SKILL.md"];
  if (!skillFile) return bytes;
  const quoted = quotedSkillMarkdown(skillFile);
  return quoted ? zipSync(skillZippable({ ...files, "SKILL.md": quoted }, executable), { level: 6 }) : bytes;
}

/** The `SKILL.md` as `withQuotedFrontmatter` saves it, or null when a save keeps it unchanged. */
export function quotedSkillMarkdown(skillFile: Uint8Array): Uint8Array | null {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(skillFile);
  const match = SKILL_FRONTMATTER.exec(text);
  const frontmatter = match?.[1];
  if (!match || frontmatter === undefined || parsesAsYaml(frontmatter)) return null;
  const quoted = frontmatter
    .split("\n")
    .map((line) => {
      const value = TOP_LEVEL_VALUE.exec(line.trimEnd());
      const key = value?.[1];
      const plain = value?.[2];
      if (key === undefined || plain === undefined || NOT_PLAIN.test(plain) || !/:(?:\s|$)/u.test(plain)) return line;
      // A JSON string is also a YAML double-quoted string.
      return `${key}: ${JSON.stringify(plain)}`;
    })
    .join("\n");
  if (!parsesAsYaml(quoted)) return null;
  const head = match[0].replace(frontmatter, () => quoted);
  return new TextEncoder().encode(`${head}${text.slice(match[0].length)}`);
}

const rejectLinks = Effect.fn("LocalSkill.rejectLinks")(function* (root: string, path: string) {
  let current = root;
  if ((yield* localIO(() => lstat(root))).isSymbolicLink())
    return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.pathSymlink")) });
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((yield* localIO(() => lstat(current))).isSymbolicLink())
      return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.pathSymlink")) });
  }
});

export class LocalSkillFailure extends Schema.TaggedError<LocalSkillFailure>()("LocalSkillFailure", {
  cause: Schema.Defect(),
}) {}

const { io: localIO, sync: localSync } = causeHelpers(LocalSkillFailure);
