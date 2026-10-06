import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentSummary, MarketplaceSkillDetail } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import { parse as parseYaml } from "yaml";
import { archiveDirectory, inspectArchive, normalizedFiles } from "./skill-package";

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
      return results.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  private directory(id: string): string {
    if (!/^local-skill-[\da-f-]{36}$/u.test(id)) throw new Error("Invalid local skill ID.");
    return join(this.root, id);
  }

  private revision(id: string, requested?: number): Effect.Effect<number, LocalSkillFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<number, LocalSkillFailure> {
      if (requested !== undefined) {
        if (!Number.isSafeInteger(requested) || requested < 1)
          return yield* new LocalSkillFailure({ cause: new Error("Invalid skill revision.") });
        return requested;
      }
      const entries = yield* localIO(() => readdir(this.directory(id), { withFileTypes: true }));
      const revisions = entries
        .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/u.test(entry.name))
        .map((entry) => Number(entry.name));
      if (!revisions.length)
        return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localNoRevisions")) });
      return Math.max(...revisions);
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
      const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
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
        const bytes = yield* this.sourceEffect(agentId, sourcePath);
        const info = yield* localSync(() => inspectArchive(bytes));
        if ((yield* this.list()).some((skill) => skill.slug === info.slug))
          return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localNameTaken")) });
        const id = `local-skill-${randomUUID()}`;
        yield* this.publishEffect(id, 1, bytes);
        return yield* this.get(id, 1);
      }),
    );
  }

  revise(
    agentId: string,
    id: string,
    expectedRevision: number,
    sourcePath: string,
  ): Effect.Effect<MarketplaceSkillDetail, LocalSkillFailure> {
    return this.serialize(
      Effect.gen({ self: this }, function* () {
        const current = yield* this.get(id);
        if (current.version !== expectedRevision)
          return yield* new LocalSkillFailure({
            cause: new Error("The skill changed. Read its latest revision before revising it."),
          });
        const bytes = yield* this.sourceEffect(agentId, sourcePath);
        if ((yield* localSync(() => inspectArchive(bytes))).slug !== current.slug)
          return yield* new LocalSkillFailure({ cause: new Error(sourceText("error.skill.localKeepName")) });
        yield* this.publishEffect(id, expectedRevision + 1, bytes);
        return yield* this.get(id, expectedRevision + 1);
      }),
    );
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
      const bytes = yield* archiveDirectory(path).pipe(
        Effect.mapError(({ cause }) => new LocalSkillFailure({ cause })),
      );
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
function localIO<A>(operation: () => Promise<A>): Effect.Effect<A, LocalSkillFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new LocalSkillFailure({ cause }) });
}
function localSync<A>(operation: () => A): Effect.Effect<A, LocalSkillFailure> {
  return Effect.try({ try: operation, catch: (cause) => new LocalSkillFailure({ cause }) });
}
