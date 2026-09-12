import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentSummary,
  InstalledSkill,
  InstallSkillInput,
  MarketplaceAgentSkill,
  MarketplaceSkillDetail,
  MarketplaceSkillPage,
  MarketplaceSkillQuery,
  MarketplaceSkillSummary,
  SetEnabledSkillInput,
  SkillPackagePreview,
  SkillSubmission,
  SubmitSkillInput,
  UninstallSkillInput,
} from "@openbot/contracts/ipc";
import { isSkillCategory } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { parse as parseYaml } from "yaml";
import type { CentralAuthManager } from "./central-auth-manager";
import type { LocalSkillLibrary } from "./local-skill-library";
import { archiveDirectory, inspectArchive, normalizedFiles } from "./skill-package";

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
  readonly #writes = new Map<string, Promise<void>>();

  constructor(
    private readonly auth: CentralAuthManager,
    private readonly listAgents: () => AgentSummary[],
    private readonly refreshAgentRuntime: (agentId: string) => Promise<void> = async () => undefined,
    readonly localLibrary?: LocalSkillLibrary,
  ) {}

  async list(query: MarketplaceSkillQuery = {}): Promise<MarketplaceSkillPage> {
    const params = new URLSearchParams();
    if (query.query) params.set("query", query.query);
    if (query.category) params.set("category", query.category);
    if (query.featured) params.set("featured", "true");
    if (query.sort) params.set("sort", query.sort);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit) params.set("limit", String(query.limit));
    const page = await this.auth.requestAuthorized(`/v1/skills/?${params}`, { method: "GET" }, decodeSkillPage);
    return {
      ...page,
      skills: page.skills.map((skill) => ({
        ...skill,
        iconUrl: this.absoluteUrl(skill.iconUrl),
        creatorAvatarUrl: this.absoluteUrl(skill.creatorAvatarUrl ?? null),
      })),
    };
  }

  async get(skillId: string): Promise<MarketplaceSkillDetail> {
    if (skillId.startsWith("local-skill-")) return this.requireLocalLibrary().get(skillId);
    const detail = await this.auth.requestAuthorized(
      `/v1/skills/${encodeURIComponent(skillId)}`,
      { method: "GET" },
      decodeSkillDetail,
    );
    return {
      ...detail,
      iconUrl: this.absoluteUrl(detail.iconUrl),
      creatorAvatarUrl: this.absoluteUrl(detail.creatorAvatarUrl ?? null),
    };
  }

  async listMine(): Promise<SkillSubmission[]> {
    const submissions = await this.auth.requestAuthorized("/v1/skills/mine", { method: "GET" }, decodeSubmissions);
    return submissions.map((item) => ({ ...item, iconUrl: this.absoluteUrl(item.iconUrl) }));
  }

  async stage(path: string): Promise<SkillPackagePreview> {
    this.expireDrafts();
    const stats = await lstat(path);
    const bytes = stats.isDirectory() ? await archiveDirectory(path) : new Uint8Array(await readFile(path));
    const inspected = inspectArchive(bytes);
    const draftId = randomUUID();
    const preview = { draftId, ...inspected, size: bytes.byteLength };
    this.#drafts.set(draftId, { bytes, preview, createdAt: Date.now() });
    return preview;
  }

  async submit(input: SubmitSkillInput): Promise<SkillSubmission> {
    if (!isSkillCategory(input.category)) throw new Error("Unknown skill category.");
    const draft = this.#drafts.get(input.draftId);
    if (!draft || Date.now() - draft.createdAt > DRAFT_LIFETIME_MS)
      throw new Error("The selected skill package expired. Choose it again.");
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
    const submission = await this.auth.requestAuthorized(
      "/v1/skills/",
      { method: "POST", body: form },
      decodeSubmission,
      30_000,
    );
    this.#drafts.delete(input.draftId);
    return { ...submission, iconUrl: this.absoluteUrl(submission.iconUrl) };
  }

  async listInstalled(agentId: string): Promise<InstalledSkill[]> {
    const agent = this.requireAgent(agentId);
    const lock = await readLock(agent.workspacePath);
    const installed: InstalledSkill[] = [];
    for (const entry of Object.values(lock.skills)) {
      let availableVersion = entry.version;
      try {
        availableVersion = (await this.get(entry.skillId)).version;
      } catch {
        /* Keep local state usable offline. */
      }
      const state = await installedState(agent.workspacePath, entry);
      installed.push(
        toInstalledSkill(entry, availableVersion, state, await installedSkillDescription(agent.workspacePath, entry)),
      );
    }
    return installed.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listInstalledForChatTags(agentId: string): Promise<InstalledSkill[]> {
    const agent = this.requireAgent(agentId);
    const lock = await readLock(agent.workspacePath);
    const installed: InstalledSkill[] = [];
    for (const entry of Object.values(lock.skills)) {
      if (entry.enabled === false) continue;
      installed.push(
        toInstalledSkill(
          entry,
          entry.version,
          await installedState(agent.workspacePath, entry),
          await installedSkillDescription(agent.workspacePath, entry),
        ),
      );
    }
    return installed.sort((a, b) => a.name.localeCompare(b.name));
  }

  async install(input: InstallSkillInput): Promise<InstalledSkill> {
    const agent = this.requireAgent(input.agentId);
    const detail = await this.get(input.skillId);
    const bundle = input.skillId.startsWith("local-skill-")
      ? await this.requireLocalLibrary().bundle(input.skillId, detail.version)
      : await this.auth.downloadAuthorized(`/v1/skills/${encodeURIComponent(input.skillId)}/content`);
    return this.installResolved(agent, detail, bundle, input.replaceModified);
  }

  async installVersion(input: {
    agentId: string;
    skillId: string;
    versionId: string;
    replaceModified?: boolean;
  }): Promise<InstalledSkill> {
    const agent = this.requireAgent(input.agentId);
    const detail = await this.auth.requestAuthorized(
      `/v1/skills/${encodeURIComponent(input.skillId)}/versions/${encodeURIComponent(input.versionId)}`,
      { method: "GET" },
      decodeSkillDetail,
    );
    const bundle = await this.auth.downloadAuthorized(
      `/v1/skills/${encodeURIComponent(input.skillId)}/versions/${encodeURIComponent(input.versionId)}/content`,
    );
    return this.installResolved(agent, detail, bundle, input.replaceModified);
  }

  async listPublishable(agentId: string): Promise<MarketplaceAgentSkill[]> {
    const agent = this.requireAgent(agentId);
    const lock = await readLock(agent.workspacePath);
    const result: MarketplaceAgentSkill[] = [];
    for (const entry of Object.values(lock.skills)) {
      if (entry.skillId.startsWith("local-skill-"))
        throw new Error("Publish local skills separately before publishing this agent.");
      const state = await installedState(agent.workspacePath, entry);
      if (state !== "installed") throw new Error(`${entry.name} has local changes or needs repair before publishing.`);
      let versionId = entry.versionId;
      if (!versionId) {
        const detail = await this.get(entry.skillId);
        if (detail.version !== entry.version)
          throw new Error(
            `${entry.name} was installed before exact-version tracking. Update or repair it before publishing.`,
          );
        versionId = detail.versionId;
      }
      result.push({
        skillId: entry.skillId,
        versionId,
        slug: entry.slug,
        name: entry.name,
        version: entry.version,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  private serialize<T>(agentId: string, write: () => Promise<T>): Promise<T> {
    const result = (this.#writes.get(agentId) ?? Promise.resolve()).then(write);
    const done = result.then(
      () => undefined,
      () => undefined,
    );
    this.#writes.set(agentId, done);
    void done.then(() => {
      if (this.#writes.get(agentId) === done) this.#writes.delete(agentId);
    });
    return result;
  }

  private installResolved(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ): Promise<InstalledSkill> {
    return this.serialize(agent.id, () => this.writeResolved(agent, detail, bundle, replaceModified));
  }

  private async writeResolved(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ): Promise<InstalledSkill> {
    if (sha256(bundle) !== detail.bundleSha256)
      throw new Error("The downloaded skill did not match its signed catalog record.");
    const archive = inspectArchive(bundle);
    if (archive.slug !== detail.slug) throw new Error("The downloaded skill metadata does not match the catalog.");
    const files = normalizedFiles(bundle);
    await assertSkillPaths(agent.workspacePath, detail.slug);
    const lock = await readLock(agent.workspacePath);
    const existing = lock.skills[detail.id];
    if (Object.values(lock.skills).some((entry) => entry.slug === detail.slug && entry.skillId !== detail.id))
      throw new Error("Another installed skill uses this folder name.");
    if (!existing && Object.keys(lock.skills).length >= INPUT_LIMITS.agentSkills) {
      throw new Error(`An agent can have up to ${INPUT_LIMITS.agentSkills} skills.`);
    }
    if (existing) {
      const state = await installedState(agent.workspacePath, existing);
      if (state === "modified" && !replaceModified)
        throw new Error("This skill has local changes. Confirm replacement to continue.");
    }
    for (const target of [
      ...targetDirectories(agent.workspacePath, detail.slug),
      disabledDirectory(agent.workspacePath, detail.slug),
    ]) {
      const owner = Object.values(lock.skills).find(
        (entry) => target.endsWith(`/${entry.slug}`) || target.endsWith(`\\${entry.slug}`),
      );
      if (!owner && (await pathExists(target))) throw new Error(`An unmanaged skill already exists at ${target}.`);
    }
    const receiptId = existing?.receiptId ?? randomUUID();
    const stayDisabled = existing?.enabled === false;
    if (stayDisabled)
      await replaceTargets(agent.workspacePath, detail.slug, files, [
        disabledDirectory(agent.workspacePath, detail.slug),
      ]);
    else await replaceTargets(agent.workspacePath, detail.slug, files);
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
    await writeLock(agent.workspacePath, lock);
    if (!detail.id.startsWith("local-skill-"))
      await this.auth.requestAuthorized(
        `/v1/skills/${encodeURIComponent(detail.id)}/install`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiptId }) },
        decodeInstalledReceipt,
      );
    await this.refreshAgentRuntime(agent.id);
    return toInstalledSkill(entry, detail.version, "installed", entry.description);
  }

  uninstall(input: UninstallSkillInput): Promise<void> {
    return this.serialize(input.agentId, () => this.removeInstalled(input));
  }
  private async removeInstalled(input: UninstallSkillInput): Promise<void> {
    const agent = this.requireAgent(input.agentId);
    const lock = await readLock(agent.workspacePath);
    const entry = lock.skills[input.skillId];
    if (!entry) return;
    await assertSkillPaths(agent.workspacePath, entry.slug);
    if ((await installedState(agent.workspacePath, entry)) === "modified" && !input.removeModified) {
      throw new Error("This skill has local changes. Confirm removal to delete them.");
    }
    for (const target of [
      ...targetDirectories(agent.workspacePath, entry.slug),
      disabledDirectory(agent.workspacePath, entry.slug),
    ]) {
      await rm(target, { recursive: true, force: true });
    }
    delete lock.skills[input.skillId];
    await writeLock(agent.workspacePath, lock);
    await this.refreshAgentRuntime(input.agentId);
  }

  setEnabled(input: SetEnabledSkillInput): Promise<InstalledSkill> {
    return this.serialize(input.agentId, () => this.changeEnabled(input));
  }
  private async changeEnabled(input: SetEnabledSkillInput): Promise<InstalledSkill> {
    const agent = this.requireAgent(input.agentId);
    const lock = await readLock(agent.workspacePath);
    const entry = lock.skills[input.skillId];
    if (!entry) throw new Error("Skill not found.");
    await assertSkillPaths(agent.workspacePath, entry.slug);
    const currentlyEnabled = entry.enabled !== false;
    if (currentlyEnabled === input.enabled) {
      return toInstalledSkill(
        entry,
        entry.version,
        await installedState(agent.workspacePath, entry),
        await installedSkillDescription(agent.workspacePath, entry),
      );
    }
    if (
      !input.enabled &&
      entry.skillId.startsWith("local-skill-") &&
      (await installedState(agent.workspacePath, entry)) === "modified"
    ) {
      throw new Error("This skill has local changes. Save or reconcile both provider copies before disabling it.");
    }
    if (input.enabled) {
      const stash = disabledDirectory(agent.workspacePath, entry.slug);
      if (!(await pathExists(stash))) throw new Error("This skill needs repair before it can be enabled.");
      const files = await readSkillFiles(stash);
      await replaceTargets(agent.workspacePath, entry.slug, files);
      await rm(stash, { recursive: true, force: true });
      delete entry.enabled;
    } else {
      const live = targetDirectories(agent.workspacePath, entry.slug);
      const source = (await pathExists(live[0])) ? live[0] : (await pathExists(live[1])) ? live[1] : null;
      const stash = disabledDirectory(agent.workspacePath, entry.slug);
      if (source) {
        await mkdir(dirname(stash), { recursive: true, mode: 0o700 });
        if (await pathExists(stash)) await rm(stash, { recursive: true, force: true });
        await rename(source, stash);
      } else if (!(await pathExists(stash))) {
        throw new Error("This skill needs repair before it can be disabled.");
      }
      for (const target of live) await rm(target, { recursive: true, force: true });
      entry.enabled = false;
    }
    lock.skills[input.skillId] = entry;
    await writeLock(agent.workspacePath, lock);
    await this.refreshAgentRuntime(input.agentId);
    return toInstalledSkill(
      entry,
      entry.version,
      await installedState(agent.workspacePath, entry),
      await installedSkillDescription(agent.workspacePath, entry),
    );
  }

  private requireAgent(agentId: string): AgentSummary {
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Choose a local agent first.");
    return agent;
  }

  requireLocalLibrary(): LocalSkillLibrary {
    if (!this.localLibrary) throw new Error("Local skill library is unavailable.");
    return this.localLibrary;
  }

  async installLocal(input: { agentId: string; skillId: string; revision: number }): Promise<InstalledSkill> {
    const detail = await this.requireLocalLibrary().get(input.skillId, input.revision);
    return this.installResolved(
      this.requireAgent(input.agentId),
      detail,
      await this.requireLocalLibrary().bundle(input.skillId, input.revision),
    );
  }

  private absoluteUrl(value: string | null): string | null {
    return value ? this.auth.resolveApiUrl(value) : null;
  }
  private expireDrafts(): void {
    for (const [id, draft] of this.#drafts)
      if (Date.now() - draft.createdAt > DRAFT_LIFETIME_MS) this.#drafts.delete(id);
  }
}

function targetDirectories(workspace: string, slug: string): string[] {
  return [join(workspace, ".agents", "skills", slug), join(workspace, ".claude", "skills", slug)];
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

async function installedSkillDescription(workspace: string, entry: LockEntry): Promise<string | undefined> {
  const stored = trimmedSkillDescription(entry.description);
  if (stored) return stored;
  const roots =
    entry.enabled === false ? [disabledDirectory(workspace, entry.slug)] : targetDirectories(workspace, entry.slug);
  for (const root of roots) {
    try {
      const parsed = parseSkillMarkdownDescription(await readFile(join(root, "SKILL.md"), "utf8"));
      if (parsed) return parsed;
    } catch {
      /* Keep the lock name usable when SKILL.md is missing or malformed. */
    }
  }
}

function trimmedSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= 500 ? description : undefined;
}

function parseSkillMarkdownDescription(text: string): string | undefined {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return undefined;
  const metadata = parseYaml(match[1] ?? "");
  if (!isDynamicRecord(metadata)) return undefined;
  return trimmedSkillDescription(metadata.description);
}

async function readSkillFiles(root: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".DS_Store") continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Skill packages cannot contain symbolic links.");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        files[relative(root, path).replaceAll("\\", "/")] = new Uint8Array(await readFile(path));
      }
    }
  }
  await visit(root);
  return files;
}

async function replaceTargets(
  workspace: string,
  slug: string,
  files: Record<string, Uint8Array>,
  targets = targetDirectories(workspace, slug),
): Promise<void> {
  const completed: Array<{ target: string; backup: string | null }> = [];
  try {
    for (const target of targets) {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const stage = `${target}.openbot-stage-${randomUUID()}`;
      const backup = (await pathExists(target)) ? `${target}.openbot-backup-${randomUUID()}` : null;
      await writeFiles(stage, files);
      if (backup) await rename(target, backup);
      try {
        await rename(stage, target);
      } catch (error) {
        if (backup) await rename(backup, target);
        throw error;
      }
      completed.push({ target, backup });
    }
  } catch (error) {
    for (const item of completed.reverse()) {
      await rm(item.target, { recursive: true, force: true });
      if (item.backup) await rename(item.backup, item.target).catch(() => undefined);
    }
    throw error;
  }
  await Promise.all(
    completed.flatMap((item) => (item.backup ? [rm(item.backup, { recursive: true, force: true })] : [])),
  );
}

async function writeFiles(root: string, files: Record<string, Uint8Array>): Promise<void> {
  for (const [name, bytes] of Object.entries(files)) {
    const path = resolve(root, name);
    if (!path.startsWith(`${resolve(root)}/`) && !path.startsWith(`${resolve(root)}\\`))
      throw new Error("Unsafe skill path.");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
  }
}

async function installedState(workspace: string, entry: LockEntry): Promise<"installed" | "modified" | "needs-repair"> {
  const roots =
    entry.enabled === false ? [disabledDirectory(workspace, entry.slug)] : targetDirectories(workspace, entry.slug);
  let complete = 0;
  for (const target of roots) {
    if (!(await pathExists(target))) continue;
    complete += 1;
    try {
      const files = await readSkillFiles(target);
      if (Object.keys(files).some((name) => !(name in entry.files))) return "modified";
    } catch {
      return "modified";
    }
    for (const [name, hash] of Object.entries(entry.files)) {
      try {
        if (sha256(new Uint8Array(await readFile(join(target, name)))) !== hash) return "modified";
      } catch {
        return "needs-repair";
      }
    }
  }
  const expected = entry.enabled === false ? 1 : 2;
  return complete === expected ? "installed" : "needs-repair";
}

function lockPath(workspace: string): string {
  return join(workspace, ".openbot", "skills-lock.json");
}
async function readLock(workspace: string): Promise<SkillsLock> {
  let text: string;
  try {
    text = await readFile(lockPath(workspace), "utf8");
  } catch (error) {
    if (isDynamicRecord(error) && error.code === "ENOENT") return { version: 1, skills: {} };
    throw error;
  }
  const value = JSON.parse(text);
  if (!isSkillsLock(value)) throw new Error("The installed skill record is invalid. It was left unchanged.");
  return value;
}
async function writeLock(workspace: string, lock: SkillsLock): Promise<void> {
  const path = lockPath(workspace);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function decodeSkillPage(value: unknown): MarketplaceSkillPage {
  if (!isDynamicRecord(value) || !Array.isArray(value.skills) || !value.skills.every(isMarketplaceSkillSummary))
    throw new Error("Invalid skill marketplace response.");
  if (value.nextCursor !== null && !isString(value.nextCursor)) throw new Error("Invalid skill marketplace response.");
  return { skills: value.skills, nextCursor: value.nextCursor };
}
function decodeSkillDetail(value: unknown): MarketplaceSkillDetail {
  if (!isMarketplaceSkillDetail(value)) throw new Error("Invalid skill detail response.");
  return value;
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

function isMarketplaceSkillSummary(value: unknown): value is MarketplaceSkillSummary {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    isString(value.slug) &&
    isString(value.name) &&
    isString(value.description) &&
    isSkillCategory(value.category) &&
    isString(value.creatorName) &&
    (value.creatorAvatarUrl === undefined || value.creatorAvatarUrl === null || isString(value.creatorAvatarUrl)) &&
    isNumber(value.version) &&
    isNumber(value.installs) &&
    isBoolean(value.featured) &&
    (value.iconUrl === null || isString(value.iconUrl)) &&
    isString(value.updatedAt)
  );
}

function isMarketplaceSkillDetail(value: unknown): value is MarketplaceSkillDetail {
  return (
    isDynamicRecord(value) &&
    isMarketplaceSkillSummary(value) &&
    isString(value.versionId) &&
    isString(value.bundleSha256) &&
    isString(value.instructions) &&
    (value.examplePrompt === undefined || (isString(value.examplePrompt) && value.examplePrompt.length <= 1_000)) &&
    Array.isArray(value.files) &&
    value.files.every(isString)
  );
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

async function assertSkillPaths(workspace: string, slug: string): Promise<void> {
  for (const target of [
    ...targetDirectories(workspace, slug),
    disabledDirectory(workspace, slug),
    lockPath(workspace),
  ]) {
    let current = resolve(workspace);
    const parts = relative(current, target).split(/[\\/]/u);
    for (const part of ["", ...parts]) {
      current = join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Skill installation paths cannot contain symbolic links.");
      } catch (error) {
        if (isDynamicRecord(error) && error.code === "ENOENT") break;
        throw error;
      }
    }
  }
}
