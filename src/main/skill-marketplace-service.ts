import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentSummary,
  AgentTemplateSkill,
  InstalledSkill,
  InstallSkillInput,
  MarketplaceAgentSkill,
  MarketplaceSkillDetail,
  MarketplaceSkillPage,
  MarketplaceSkillQuery,
  SetEnabledSkillInput,
  SkillPackagePreview,
  SkillSubmission,
  SubmitSkillInput,
  UninstallSkillInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_TEMPLATE_LIMITS,
  decodeMarketplaceSkillDetail,
  decodeMarketplaceSkillPage,
  isSkillCategory,
  marketplaceQueryParams,
  SKILL_DESCRIPTION_MAX_LENGTH,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { parse as parseYaml } from "yaml";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { toArrayBuffer } from "./agent-marketplace-service";
import type { CentralAuthManager } from "./central-auth-manager";
import type { LocalSkillLibrary } from "./local-skill-library";
import { listManagedSkillsForChat, MANAGED_SKILL_FOLDERS } from "./managed-skill-service";
import { listFolderSkills } from "./skill-folder-discovery";
import { archiveDirectory, inspectArchive, inspectSkillMarkdown, normalizedFiles } from "./skill-package";

const DRAFT_LIFETIME_MS = 30 * 60 * 1000;

interface Draft {
  bytes: Uint8Array;
  preview: SkillPackagePreview;
  createdAt: number;
}
interface LockEntry {
  skillId: string;
  versionId?: string;
  slug: string;
  name: string;
  version: number;
  bundleSha256: string;
  receiptId: string;
  files: Record<string, string>;
  enabled?: boolean;
  description?: string;
}
interface SkillsLock {
  version: 1;
  skills: Record<string, LockEntry>;
}

export class SkillMarketplaceService {
  readonly #drafts = new Map<string, Draft>();
  readonly #writes = new Map<string, { gate: Semaphore.Semaphore; users: number }>();

  constructor(
    private readonly auth: CentralAuthManager,
    private readonly listAgents: () => AgentSummary[],
    private readonly refreshAgentRuntime: (agentId: string) => Effect.Effect<void, AgentLifecycleFailed> = () =>
      Effect.void,
    readonly localLibrary?: LocalSkillLibrary,
  ) {}

  list(query: MarketplaceSkillQuery = {}): Effect.Effect<MarketplaceSkillPage, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceSkillPage, SkillMarketplaceFailure> {
      const params = marketplaceQueryParams(query);
      const page = yield* this.auth
        .requestAuthorized(`/v1/skills/?${params}`, { method: "GET" }, decodeMarketplaceSkillPage)
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      return {
        ...page,
        skills: page.skills.map((skill) => ({
          ...skill,
          iconUrl: this.absoluteUrl(skill.iconUrl),
          creatorAvatarUrl: this.absoluteUrl(skill.creatorAvatarUrl ?? null),
        })),
      };
    });
  }

  get(skillId: string): Effect.Effect<MarketplaceSkillDetail, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceSkillDetail, SkillMarketplaceFailure> {
      if (skillId.startsWith("local-skill-"))
        return yield* this.requireLocalLibrary()
          .get(skillId)
          .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      const detail = yield* this.auth
        .requestAuthorized(`/v1/skills/${encodeURIComponent(skillId)}`, { method: "GET" }, decodeMarketplaceSkillDetail)
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      return {
        ...detail,
        iconUrl: this.absoluteUrl(detail.iconUrl),
        creatorAvatarUrl: this.absoluteUrl(detail.creatorAvatarUrl ?? null),
      };
    });
  }

  listMine(): Effect.Effect<SkillSubmission[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<SkillSubmission[], SkillMarketplaceFailure> {
      const submissions = yield* this.auth
        .requestAuthorized("/v1/skills/mine", { method: "GET" }, decodeSubmissions)
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      return submissions.map((item) => ({ ...item, iconUrl: this.absoluteUrl(item.iconUrl) }));
    });
  }

  stage(path: string): Effect.Effect<SkillPackagePreview, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<SkillPackagePreview, SkillMarketplaceFailure> {
      this.expireDrafts();
      const stats = yield* skillIO(() => lstat(path));
      const bytes = stats.isDirectory()
        ? yield* archiveDirectory(path).pipe(Effect.mapError(({ cause }) => new SkillMarketplaceFailure({ cause })))
        : new Uint8Array(yield* skillIO(() => readFile(path)));
      const inspected = yield* skillSync(() => inspectArchive(bytes));
      const draftId = randomUUID();
      const preview = { draftId, ...inspected, size: bytes.byteLength };
      this.#drafts.set(draftId, { bytes, preview, createdAt: Date.now() });
      return preview;
    });
  }

  submit(input: SubmitSkillInput): Effect.Effect<SkillSubmission, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<SkillSubmission, SkillMarketplaceFailure> {
      if (!isSkillCategory(input.category))
        return yield* new SkillMarketplaceFailure({ cause: new Error("Unknown skill category.") });
      const draft = this.#drafts.get(input.draftId);
      if (!draft || Date.now() - draft.createdAt > DRAFT_LIFETIME_MS)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.draftExpired")) });
      const form = new FormData();
      form.set("category", input.category);
      if (input.showCreatorAvatar !== undefined) form.set("showCreatorAvatar", String(input.showCreatorAvatar));
      if (input.skillId) form.set("skillId", input.skillId);
      form.set(
        "bundle",
        new Blob([toArrayBuffer(draft.bytes)], { type: "application/zip" }),
        `${draft.preview.slug}.zip`,
      );
      if (input.icon)
        form.set("icon", new Blob([toArrayBuffer(input.icon.bytes)], { type: input.icon.mimeType }), "icon");
      const submission = yield* this.auth
        .requestAuthorized("/v1/skills/", { method: "POST", body: form }, decodeSubmission, 30_000)
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      this.#drafts.delete(input.draftId);
      return { ...submission, iconUrl: this.absoluteUrl(submission.iconUrl) };
    });
  }

  listInstalled(agentId: string): Effect.Effect<InstalledSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const installed: InstalledSkill[] = [];
      for (const entry of Object.values(lock.skills)) {
        let availableVersion = entry.version;
        const detail = yield* Effect.result(this.get(entry.skillId));
        if (Result.isSuccess(detail)) availableVersion = detail.success.version;
        const state = yield* installedState(agent.workspacePath, entry);
        installed.push(
          toInstalledSkill(
            entry,
            availableVersion,
            state,
            yield* installedSkillDescription(agent.workspacePath, entry),
          ),
        );
      }
      installed.push(
        ...(yield* listFolderSkills(agent, lockedSlugs(lock)).pipe(
          Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
        )),
      );
      return installed.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  listInstalledForChatTags(agentId: string): Effect.Effect<InstalledSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const installed: InstalledSkill[] = yield* listManagedSkillsForChat(agent).pipe(
        Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
      );
      for (const skill of yield* listFolderSkills(agent, lockedSlugs(lock)).pipe(
        Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
      ))
        if (!skill.problem) installed.push(skill);
      for (const entry of Object.values(lock.skills)) {
        if (entry.enabled === false) continue;
        installed.push(
          toInstalledSkill(
            entry,
            entry.version,
            yield* installedState(agent.workspacePath, entry),
            yield* installedSkillDescription(agent.workspacePath, entry),
          ),
        );
      }
      return installed.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  install(input: InstallSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      // A pinned version is served by the versions endpoint, which a local skill has no entry in: a
      // local skill is held on this computer and has no published version to ask for.
      if (input.versionId) {
        if (input.skillId.startsWith("local-skill-"))
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.localHasNoVersion")) });
        return yield* this.installVersion({ ...input, versionId: input.versionId });
      }
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const detail = yield* this.get(input.skillId);
      const bundle = input.skillId.startsWith("local-skill-")
        ? yield* this.requireLocalLibrary()
            .bundle(input.skillId, detail.version)
            .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })))
        : yield* this.auth
            .downloadAuthorized(`/v1/skills/${encodeURIComponent(input.skillId)}/content`)
            .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      return yield* this.installResolved(agent, detail, bundle, input.replaceModified);
    });
  }

  installVersion(input: {
    agentId: string;
    skillId: string;
    versionId: string;
    replaceModified?: boolean;
  }): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const detail = yield* this.auth
        .requestAuthorized(
          `/v1/skills/${encodeURIComponent(input.skillId)}/versions/${encodeURIComponent(input.versionId)}`,
          { method: "GET" },
          decodeMarketplaceSkillDetail,
        )
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      const bundle = yield* this.auth
        .downloadAuthorized(
          `/v1/skills/${encodeURIComponent(input.skillId)}/versions/${encodeURIComponent(input.versionId)}/content`,
        )
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      return yield* this.installResolved(agent, detail, bundle, input.replaceModified);
    });
  }

  listPublishable(agentId: string): Effect.Effect<MarketplaceAgentSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceAgentSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const result: MarketplaceAgentSkill[] = [];
      for (const entry of Object.values(lock.skills)) {
        if (entry.enabled === false) continue;
        if (entry.skillId.startsWith("local-skill-"))
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.publishLocalFirst")) });
        result.push(yield* this.publishedReferenceEffect(agent, entry));
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  /**
   * The skills an agent template carries. A marketplace skill is a reference to its exact version;
   * a local or workspace skill is its `SKILL.md` text only, never its other files.
   */

  listTemplateSkills(agentId: string): Effect.Effect<AgentTemplateSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplateSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const result: AgentTemplateSkill[] = [];
      for (const entry of Object.values(lock.skills)) {
        if (entry.enabled === false) continue;
        if (entry.skillId.startsWith("local-skill-")) {
          const [directory] = targetDirectories(agent.workspacePath, entry.slug);
          result.push(yield* embeddedSkill(join(directory, "SKILL.md"), entry.name));
        } else result.push({ kind: "marketplace", ...(yield* this.publishedReferenceEffect(agent, entry)) });
      }
      for (const skill of yield* listFolderSkills(agent, lockedSlugs(lock)).pipe(
        Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
      )) {
        if (skill.problem || !skill.location) continue;
        result.push(yield* embeddedSkill(join(agent.workspacePath, skill.location, "SKILL.md"), skill.name));
      }
      // An install writes each skill to a folder named by its slug, so two skills with one slug would
      // make every install of the template fail.
      const slugs = new Set<string>();
      for (const skill of result) {
        if (slugs.has(skill.slug))
          return yield* new SkillMarketplaceFailure({
            cause: new Error(sourceText("error.skill.duplicateSlug", { slug: skill.slug })),
          });
        slugs.add(skill.slug);
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  private publishedReferenceEffect(
    agent: AgentSummary,
    entry: LockEntry,
  ): Effect.Effect<MarketplaceAgentSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceAgentSkill, SkillMarketplaceFailure> {
      const state = yield* installedState(agent.workspacePath, entry);
      if (state !== "installed")
        return yield* new SkillMarketplaceFailure({
          cause: new Error(sourceText("error.skill.publishNeedsRepair", { name: entry.name })),
        });
      let versionId = entry.versionId;
      if (!versionId) {
        const detail = yield* this.get(entry.skillId);
        if (detail.version !== entry.version)
          return yield* new SkillMarketplaceFailure({
            cause: new Error(sourceText("error.skill.publishUntracked", { name: entry.name })),
          });
        versionId = detail.versionId;
      }
      return {
        skillId: entry.skillId,
        versionId,
        slug: entry.slug,
        name: entry.name,
        version: entry.version,
      };
    });
  }

  private serialize<A>(
    agentId: string,
    operation: Effect.Effect<A, SkillMarketplaceFailure>,
  ): Effect.Effect<A, SkillMarketplaceFailure> {
    return Effect.suspend(() => {
      const entry = this.#writes.get(agentId) ?? { gate: Semaphore.makeUnsafe(1), users: 0 };
      entry.users += 1;
      this.#writes.set(agentId, entry);
      return entry.gate.withPermit(Effect.uninterruptible(operation)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.users -= 1;
            if (entry.users === 0) this.#writes.delete(agentId);
          }),
        ),
      );
    });
  }

  private installResolved(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ) {
    return this.serialize(agent.id, this.writeResolvedEffect(agent, detail, bundle, replaceModified));
  }

  private writeResolvedEffect(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      if (sha256(bundle) !== detail.bundleSha256)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.bundleMismatch")) });
      const archive = yield* skillSync(() => inspectArchive(bundle));
      if (archive.slug !== detail.slug)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.metadataMismatch")) });
      const files = yield* skillSync(() => normalizedFiles(bundle));
      yield* assertSkillPaths(agent.workspacePath, detail.slug);
      const lock = yield* readLock(agent.workspacePath);
      const existing = lock.skills[detail.id];
      if (Object.values(lock.skills).some((entry) => entry.slug === detail.slug && entry.skillId !== detail.id))
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.folderTaken")) });
      if (!existing && Object.keys(lock.skills).length >= INPUT_LIMITS.agentSkills) {
        return yield* new SkillMarketplaceFailure({
          cause: new Error(sourceText("error.skill.tooManySkills", { limit: INPUT_LIMITS.agentSkills })),
        });
      }
      if (existing) {
        const state = yield* installedState(agent.workspacePath, existing);
        if (state === "modified" && !replaceModified)
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.replaceModified")) });
      }
      for (const target of [
        ...targetDirectories(agent.workspacePath, detail.slug),
        disabledDirectory(agent.workspacePath, detail.slug),
      ]) {
        const owner = Object.values(lock.skills).find(
          (entry) => target.endsWith(`/${entry.slug}`) || target.endsWith(`\\${entry.slug}`),
        );
        if (!owner && (yield* pathExists(target)))
          return yield* new SkillMarketplaceFailure({
            cause: new Error(sourceText("error.skill.unmanagedExists", { path: target })),
          });
      }
      const receiptId = existing?.receiptId ?? randomUUID();
      const stayDisabled = existing?.enabled === false;
      if (stayDisabled)
        yield* replaceTargets(agent.workspacePath, detail.slug, files, [
          disabledDirectory(agent.workspacePath, detail.slug),
        ]);
      else yield* replaceTargets(agent.workspacePath, detail.slug, files);
      const entry: LockEntry = {
        skillId: detail.id,
        versionId: detail.versionId,
        slug: detail.slug,
        name: detail.name,
        version: detail.version,
        bundleSha256: detail.bundleSha256,
        receiptId,
        files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])),
        description: detail.description,
        ...(stayDisabled ? { enabled: false } : {}),
      };
      lock.skills[detail.id] = entry;
      yield* writeLock(agent.workspacePath, lock);
      if (!detail.id.startsWith("local-skill-"))
        yield* this.auth
          .requestAuthorized(
            `/v1/skills/${encodeURIComponent(detail.id)}/install`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiptId }) },
            decodeInstalledReceipt,
          )
          .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      yield* this.refreshAgentRuntime(agent.id).pipe(
        Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
      );
      return toInstalledSkill(entry, detail.version, "installed", entry.description);
    });
  }

  uninstall(input: UninstallSkillInput): Effect.Effect<void, SkillMarketplaceFailure> {
    return this.serialize(input.agentId, this.removeInstalledEffect(input));
  }
  private removeInstalledEffect(input: UninstallSkillInput): Effect.Effect<void, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const lock = yield* readLock(agent.workspacePath);
      const entry = lock.skills[input.skillId];
      if (!entry) return;
      yield* assertSkillPaths(agent.workspacePath, entry.slug);
      if ((yield* installedState(agent.workspacePath, entry)) === "modified" && !input.removeModified) {
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.removeModified")) });
      }
      for (const target of [
        ...(entry.enabled === false ? [] : targetDirectories(agent.workspacePath, entry.slug)),
        disabledDirectory(agent.workspacePath, entry.slug),
      ]) {
        yield* skillIO(() => rm(target, { recursive: true, force: true }));
      }
      delete lock.skills[input.skillId];
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(input.agentId).pipe(
        Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
      );
    });
  }

  setEnabled(input: SetEnabledSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return this.serialize(input.agentId, this.changeEnabledEffect(input));
  }
  private changeEnabledEffect(input: SetEnabledSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const lock = yield* readLock(agent.workspacePath);
      const entry = lock.skills[input.skillId];
      if (!entry) return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.notFound")) });
      yield* assertSkillPaths(agent.workspacePath, entry.slug);
      const currentlyEnabled = entry.enabled !== false;
      if (currentlyEnabled === input.enabled) {
        return toInstalledSkill(
          entry,
          entry.version,
          yield* installedState(agent.workspacePath, entry),
          yield* installedSkillDescription(agent.workspacePath, entry),
        );
      }
      if (!input.enabled) {
        const state = yield* installedState(agent.workspacePath, entry);
        if (state === "modified")
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.disableModified")) });
        if (state === "needs-repair")
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.disableNeedsRepair")) });
      }
      if (input.enabled) {
        const stash = disabledDirectory(agent.workspacePath, entry.slug);
        if (!(yield* pathExists(stash)))
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.enableNeedsRepair")) });
        for (const target of targetDirectories(agent.workspacePath, entry.slug)) {
          if (yield* pathExists(target))
            return yield* new SkillMarketplaceFailure({
              cause: new Error(sourceText("error.skill.providerFolderOccupied")),
            });
        }
        const files = yield* readSkillFiles(stash);
        yield* replaceTargets(agent.workspacePath, entry.slug, files);
        yield* skillIO(() => rm(stash, { recursive: true, force: true }));
        delete entry.enabled;
      } else {
        const live = targetDirectories(agent.workspacePath, entry.slug);
        const [primary, fallback] = live;
        const source = (yield* pathExists(primary)) ? primary : (yield* pathExists(fallback)) ? fallback : null;
        const stash = disabledDirectory(agent.workspacePath, entry.slug);
        if (source) {
          yield* skillIO(() => mkdir(dirname(stash), { recursive: true, mode: 0o700 }));
          if (yield* pathExists(stash)) yield* skillIO(() => rm(stash, { recursive: true, force: true }));
          yield* skillIO(() => rename(source, stash));
        } else if (!(yield* pathExists(stash))) {
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.disableNeedsRepair")) });
        }
        for (const target of live) yield* skillIO(() => rm(target, { recursive: true, force: true }));
        entry.enabled = false;
      }
      lock.skills[input.skillId] = entry;
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(input.agentId).pipe(
        Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
      );
      return toInstalledSkill(
        entry,
        entry.version,
        yield* installedState(agent.workspacePath, entry),
        yield* installedSkillDescription(agent.workspacePath, entry),
      );
    });
  }

  private requireAgent(agentId: string): AgentSummary {
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.skill.chooseLocalAgent"));
    return agent;
  }

  requireLocalLibrary(): LocalSkillLibrary {
    if (!this.localLibrary) throw new Error(sourceText("error.skill.localLibraryUnavailable"));
    return this.localLibrary;
  }

  installLocal(input: {
    agentId: string;
    skillId: string;
    revision: number;
  }): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const detail = yield* this.requireLocalLibrary()
        .get(input.skillId, input.revision)
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      const bundle = yield* this.requireLocalLibrary()
        .bundle(input.skillId, input.revision)
        .pipe(Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })));
      return yield* this.installResolved(yield* skillSync(() => this.requireAgent(input.agentId)), detail, bundle);
    });
  }

  private absoluteUrl(value: string | null): string | null {
    return value ? this.auth.resolveApiUrl(value) : null;
  }
  private expireDrafts(): void {
    for (const [id, draft] of this.#drafts)
      if (Date.now() - draft.createdAt > DRAFT_LIFETIME_MS) this.#drafts.delete(id);
  }
}

function targetDirectories(workspace: string, slug: string): [string, string] {
  const [agents, claude] = MANAGED_SKILL_FOLDERS;
  return [join(workspace, agents, slug), join(workspace, claude, slug)];
}

function disabledDirectory(workspace: string, slug: string): string {
  return join(workspace, ".openbot", "skills-disabled", slug);
}

function toInstalledSkill(
  entry: LockEntry,
  availableVersion: number,
  state: "installed" | "modified" | "needs-repair" | "update-available",
  description?: string,
): InstalledSkill {
  const resolved = state === "installed" && availableVersion > entry.version ? "update-available" : state;
  const resolvedDescription = trimmedSkillDescription(description ?? entry.description);
  return {
    skillId: entry.skillId,
    slug: entry.slug,
    name: entry.name,
    installedVersion: entry.version,
    availableVersion,
    state: resolved,
    enabled: entry.enabled !== false,
    origin: entry.skillId.startsWith("local-skill-") ? "local" : "marketplace",
    ...(resolvedDescription ? { description: resolvedDescription } : {}),
  };
}

const installedSkillDescription = Effect.fn("SkillMarketplace.description")(function* (
  workspace: string,
  entry: LockEntry,
) {
  const stored = trimmedSkillDescription(entry.description);
  if (stored) return stored;
  const roots =
    entry.enabled === false ? [disabledDirectory(workspace, entry.slug)] : targetDirectories(workspace, entry.slug);
  for (const root of roots) {
    const result = yield* Effect.result(
      skillIO(() => readFile(join(root, "SKILL.md"), "utf8")).pipe(
        Effect.flatMap((text) => skillSync(() => parseSkillMarkdownDescription(text))),
      ),
    );
    if (Result.isSuccess(result) && result.success) return result.success;
  }
});

function trimmedSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= SKILL_DESCRIPTION_MAX_LENGTH ? description : undefined;
}

function parseSkillMarkdownDescription(text: string): string | undefined {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return undefined;
  const metadata = parseYaml(match[1] ?? "");
  if (!isDynamicRecord(metadata)) return undefined;
  return trimmedSkillDescription(metadata.description);
}

const readSkillFiles = Effect.fn("SkillMarketplace.readFiles")(function* (root: string) {
  const files: Record<string, Uint8Array> = {};
  const visit = (directory: string): Effect.Effect<void, SkillMarketplaceFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* skillIO(() => readdir(directory, { withFileTypes: true }))) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.symlinks")) });
        if (entry.isDirectory()) yield* visit(path);
        else if (entry.isFile())
          files[relative(root, path).replaceAll("\\", "/")] = new Uint8Array(yield* skillIO(() => readFile(path)));
      }
    });
  yield* visit(root);
  return files;
});

const replaceTargets = Effect.fn("SkillMarketplace.replaceTargets")(function* (
  workspace: string,
  slug: string,
  files: Record<string, Uint8Array>,
  targets: readonly string[] = targetDirectories(workspace, slug),
) {
  const completed: Array<{ target: string; backup: string | null }> = [];
  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      for (const target of targets) {
        yield* skillIO(() => mkdir(dirname(target), { recursive: true, mode: 0o700 }));
        const stage = `${target}.openbot-stage-${randomUUID()}`;
        const backup = (yield* pathExists(target)) ? `${target}.openbot-backup-${randomUUID()}` : null;
        yield* writeFiles(stage, files);
        if (backup) yield* skillIO(() => rename(target, backup));
        const moved = yield* Effect.result(skillIO(() => rename(stage, target)));
        if (Result.isFailure(moved)) {
          if (backup) yield* skillIO(() => rename(backup, target));
          return yield* moved.failure;
        }
        completed.push({ target, backup });
      }
    }),
  );
  if (Result.isFailure(outcome)) {
    for (const item of completed.reverse()) {
      yield* skillIO(() => rm(item.target, { recursive: true, force: true }));
      const backup = item.backup;
      if (backup) yield* skillIO(() => rename(backup, item.target)).pipe(Effect.catch(() => Effect.void));
    }
    return yield* outcome.failure;
  }
  yield* Effect.forEach(
    completed,
    (item) => {
      const backup = item.backup;
      return backup ? skillIO(() => rm(backup, { recursive: true, force: true })) : Effect.void;
    },
    { concurrency: "unbounded", discard: true },
  );
}, Effect.uninterruptible);

const writeFiles = Effect.fn("SkillMarketplace.writeFiles")(function* (
  root: string,
  files: Record<string, Uint8Array>,
) {
  for (const [name, bytes] of Object.entries(files)) {
    const path = resolve(root, name);
    if (!path.startsWith(`${resolve(root)}/`) && !path.startsWith(`${resolve(root)}\\`))
      return yield* new SkillMarketplaceFailure({ cause: new Error("Unsafe skill path.") });
    yield* skillIO(() => mkdir(dirname(path), { recursive: true, mode: 0o700 }));
    yield* skillIO(() => writeFile(path, bytes, { mode: 0o600 }));
  }
});

const hasUnexpectedSkillFiles = Effect.fn("SkillMarketplace.checkFiles")(function* (
  root: string,
  expected: Record<string, string>,
) {
  const paths = Object.keys(expected);
  const visit = (directory: string): Effect.Effect<boolean, SkillMarketplaceFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* skillIO(() => readdir(directory, { withFileTypes: true }))) {
        const path = join(directory, entry.name);
        const name = relative(root, path).replaceAll("\\", "/");
        if (entry.isSymbolicLink()) return true;
        if (entry.isDirectory()) {
          if (!paths.some((expectedPath) => expectedPath.startsWith(`${name}/`)) || (yield* visit(path))) return true;
        } else if (!entry.isFile() || !(name in expected)) return true;
      }
      return false;
    });
  return yield* visit(root);
});

const installedState = Effect.fn("SkillMarketplace.installedState")(function* (
  workspace: string,
  entry: LockEntry,
): Effect.fn.Return<"installed" | "modified" | "needs-repair", SkillMarketplaceFailure> {
  const roots =
    entry.enabled === false ? [disabledDirectory(workspace, entry.slug)] : targetDirectories(workspace, entry.slug);
  let complete = 0;
  let missing = false;
  for (const target of roots) {
    if (!(yield* pathExists(target))) continue;
    complete += 1;
    const unexpected = yield* Effect.result(hasUnexpectedSkillFiles(target, entry.files));
    if (Result.isFailure(unexpected) || unexpected.success) return "modified";
    for (const [name, hash] of Object.entries(entry.files)) {
      const content = yield* Effect.result(skillIO(() => readFile(join(target, name))));
      if (Result.isSuccess(content)) {
        if (sha256(new Uint8Array(content.success)) !== hash) return "modified";
      } else {
        const error = content.failure.cause;
        if (!isDynamicRecord(error) || error.code !== "ENOENT") return "modified";
        missing = true;
      }
    }
  }
  const expected = entry.enabled === false ? 1 : 2;
  return complete === expected && !missing ? "installed" : "needs-repair";
});

/**
 * One skill's `SKILL.md` as a template carries it. The slug and name are what an install derives
 * from the same text, so a folder name that is not a valid slug does not travel.
 */
const embeddedSkill = Effect.fn("SkillMarketplace.embeddedSkill")(function* (
  path: string,
  label: string,
): Effect.fn.Return<AgentTemplateSkill, SkillMarketplaceFailure> {
  const tooLarge = sourceText("error.skill.templateMarkdownTooLarge", { name: label });
  if ((yield* skillIO(() => stat(path))).size > AGENT_TEMPLATE_LIMITS.skillMarkdown)
    return yield* new SkillMarketplaceFailure({ cause: new Error(tooLarge) });
  const markdown = yield* skillIO(() => readFile(path, "utf8"));
  if (markdown.length > AGENT_TEMPLATE_LIMITS.skillMarkdown)
    return yield* new SkillMarketplaceFailure({ cause: new Error(tooLarge) });
  const info = yield* skillSync(() => inspectSkillMarkdown(markdown)).pipe(
    Effect.mapError(
      ({ cause }) =>
        new SkillMarketplaceFailure({
          cause: new Error(`${label}: ${cause instanceof Error ? cause.message : "SKILL.md is invalid."}`),
        }),
    ),
  );
  return { kind: "embedded", slug: info.slug, name: info.name, markdown };
});

function lockedSlugs(lock: SkillsLock): Set<string> {
  return new Set(Object.values(lock.skills).map((entry) => entry.slug));
}

function lockPath(workspace: string): string {
  return join(workspace, ".openbot", "skills-lock.json");
}
const readLock = Effect.fn("SkillMarketplace.readLock")(function* (
  workspace: string,
): Effect.fn.Return<SkillsLock, SkillMarketplaceFailure> {
  const content = yield* Effect.result(skillIO(() => readFile(lockPath(workspace), "utf8")));
  if (Result.isFailure(content)) {
    const error = content.failure.cause;
    if (isDynamicRecord(error) && error.code === "ENOENT") return { version: 1, skills: {} };
    return yield* content.failure;
  }
  return yield* skillSync(() => {
    const value = JSON.parse(content.success);
    if (!isSkillsLock(value)) throw new Error(sourceText("error.skill.lockInvalid"));
    return value;
  });
});
const writeLock = Effect.fn("SkillMarketplace.writeLock")((workspace: string, lock: SkillsLock) =>
  writeFileAtomically(lockPath(workspace), `${JSON.stringify(lock, null, 2)}\n`, { createDirectory: true }).pipe(
    Effect.mapError((error) => new SkillMarketplaceFailure({ cause: error.cause })),
  ),
);
const pathExists = Effect.fn("SkillMarketplace.pathExists")((path: string) =>
  skillIO(() => lstat(path)).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  ),
);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeSubmissions(value: unknown): SkillSubmission[] {
  if (!Array.isArray(value) || !value.every(isSkillSubmission)) throw new Error("Invalid skill submissions.");
  return value;
}
function decodeSubmission(value: unknown): SkillSubmission {
  if (!isSkillSubmission(value)) throw new Error("Invalid skill submission response.");
  return value;
}
function decodeInstalledReceipt(value: unknown): { installed: true } {
  if (!isDynamicRecord(value) || value.installed !== true) throw new Error("Invalid install receipt response.");
  return { installed: true };
}

function isSkillSubmission(value: unknown): value is SkillSubmission {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    (value.showCreatorAvatar === undefined || isBoolean(value.showCreatorAvatar)) &&
    isString(value.skillId) &&
    isString(value.slug) &&
    isString(value.name) &&
    isString(value.description) &&
    isSkillCategory(value.category) &&
    isNumber(value.version) &&
    isOneOf(["pending", "approved", "rejected"], value.status) &&
    (value.rejectionNote === null || isString(value.rejectionNote)) &&
    (value.iconUrl === null || isString(value.iconUrl)) &&
    isString(value.createdAt)
  );
}

function isLockEntry(value: unknown): value is LockEntry {
  return (
    isDynamicRecord(value) &&
    isString(value.skillId) &&
    (value.versionId === undefined || isString(value.versionId)) &&
    isString(value.slug) &&
    isString(value.name) &&
    isNumber(value.version) &&
    isString(value.bundleSha256) &&
    isString(value.receiptId) &&
    isDynamicRecord(value.files) &&
    Object.values(value.files).every(isString) &&
    (value.enabled === undefined || isBoolean(value.enabled)) &&
    (value.description === undefined || isString(value.description))
  );
}

function isSkillsLock(value: unknown): value is SkillsLock {
  return (
    isDynamicRecord(value) &&
    value.version === 1 &&
    isDynamicRecord(value.skills) &&
    Object.values(value.skills).every(isLockEntry)
  );
}

const assertSkillPaths = Effect.fn("SkillMarketplace.checkPaths")(function* (workspace: string, slug: string) {
  for (const target of [
    ...targetDirectories(workspace, slug),
    disabledDirectory(workspace, slug),
    lockPath(workspace),
  ]) {
    let current = resolve(workspace);
    const parts = relative(current, target).split(/[\\/]/u);
    for (const part of ["", ...parts]) {
      current = join(current, part);
      const entry = yield* Effect.result(skillIO(() => lstat(current)));
      if (Result.isFailure(entry)) {
        const error = entry.failure.cause;
        if (isDynamicRecord(error) && error.code === "ENOENT") break;
        return yield* entry.failure;
      }
      if (entry.success.isSymbolicLink())
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.installPathSymlink")) });
    }
  }
});

export class SkillMarketplaceFailure extends Schema.TaggedError<SkillMarketplaceFailure>()("SkillMarketplaceFailure", {
  cause: Schema.Defect(),
}) {}
function skillIO<A>(operation: () => Promise<A>): Effect.Effect<A, SkillMarketplaceFailure> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new SkillMarketplaceFailure({ cause }) });
}

function skillSync<A>(operation: () => A): Effect.Effect<A, SkillMarketplaceFailure> {
  return Effect.try({ try: operation, catch: (cause) => new SkillMarketplaceFailure({ cause }) });
}
