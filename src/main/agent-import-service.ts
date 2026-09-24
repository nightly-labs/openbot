// Agent import into the local host from one `.zip` export.
//
// `stage` reads only the manifest and the avatars and measures the other entries without
// inflating them, so a large export previews quickly. `apply` inflates one agent at a time.
// Each agent is created through the same services the user reaches by hand. When one step fails,
// that agent is deleted and reported, and the other agents continue.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { AVATAR_MIME_TYPES, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_IMPORT_LIMITS,
  type AgentImportPreview,
  type AgentImportResult,
  type AgentImportSkipped,
  type AgentSummary,
  type ApplyAgentImportInput,
  type AvatarImageInput,
  type CreateRoutineInput,
} from "@openbot/contracts/ipc";
import { unzipSync, zipSync } from "fflate";
import { isPathInside } from "../backend/path-containment";
import { AGENT_IMPORT_MANIFEST, decodeImportManifest, type ImportAgent } from "./agent-import-manifest";
import type { LocalSkillLibrary } from "./local-skill-library";
import { inspectArchive, isUnsafeArchivePath } from "./skill-package";

/** Skill folders are copied here, published to the local library, and removed again. */
const SKILL_STAGING = ".openbot/import-skills";
/** Workspace files of an imported agent go under this folder, so they never replace OpenBot's own. */
const IMPORTED_FILES = "imported";

export interface AgentImportAgents {
  listAgents(): AgentSummary[];
  createAgentProfile(input: {
    name: string;
    title?: string;
    description: string;
    avatarSeed: string;
    avatarHue: null;
  }): Promise<AgentSummary>;
  createRoutine(input: CreateRoutineInput, options?: { recordConversationEvent?: boolean }): unknown;
  createMemory(input: { agentId: string; text: string }): unknown;
  setAvatar(agentId: string, image: AvatarImageInput | null): Promise<AgentSummary>;
  deleteAgent(agentId: string): Promise<void>;
}

export interface AgentImportSkills {
  library(): Pick<LocalSkillLibrary, "list" | "create" | "revise" | "withdraw">;
  installLocal(input: { agentId: string; skillId: string; revision: number }): Promise<unknown>;
}

interface StagedEntry {
  size: number;
}

interface StagedImport {
  path: string;
  /** The archive `apply` reads must be the one the preview checked. */
  sha256: string;
  agents: ImportAgent[];
  wrapper: string;
  avatars: Map<string, AvatarImageInput>;
}

export class AgentImportService {
  #staged: { token: string; value: StagedImport } | null = null;

  constructor(
    private readonly agents: AgentImportAgents,
    private readonly skills: AgentImportSkills,
    private readonly timezone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {}

  /** Reads and checks an export. A new stage replaces the previous one. */
  async stage(path: string): Promise<AgentImportPreview> {
    this.#staged = null;
    const bytes = await readArchive(path);
    const entries = listEntries(bytes);
    const wrapper = wrapperFolder([...entries.keys()]);
    const inner = new Map([...entries].map(([name, entry]) => [name.slice(wrapper.length), entry]));
    const manifestName = `${wrapper}${AGENT_IMPORT_MANIFEST}`;
    if (!entries.has(manifestName)) throw new Error(`The export must contain ${AGENT_IMPORT_MANIFEST}.`);
    const { manifest, warnings } = decodeImportManifest(
      extract(bytes, (name) => name === manifestName)[manifestName] ?? new Uint8Array(),
    );

    const avatarPaths = new Set(manifest.agents.flatMap((agent) => (agent.avatar ? [wrapper + agent.avatar] : [])));
    const avatarBytes = extract(bytes, (name) => avatarPaths.has(name));
    const avatars = new Map<string, AvatarImageInput>();
    const existing = new Set(this.agents.listAgents().map((agent) => agent.name.toLowerCase()));
    for (const agent of manifest.agents) {
      for (const skill of agent.skills)
        if (!inner.has(`${skill}/SKILL.md`))
          throw new Error(`${agent.name}: the skill folder ${skill} has no SKILL.md.`);
      if (agent.avatar) {
        const image = avatarImage(avatarBytes[wrapper + agent.avatar]);
        if (image) avatars.set(agent.key, image);
        else warnings.push(`${agent.name}: the avatar is skipped because it is not a PNG, JPEG, or WebP under 512 KB.`);
      }
    }

    const token = randomUUID();
    this.#staged = { token, value: { path, sha256: sha256(bytes), agents: manifest.agents, wrapper, avatars } };
    return {
      token,
      sourceApp: manifest.sourceApp,
      exportedAt: manifest.exportedAt,
      agents: manifest.agents.map((agent) => {
        const files = agent.files ? filesUnder(inner, agent.files) : [];
        const avatar = avatars.get(agent.key);
        return {
          key: agent.key,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarUrl: avatar ? `data:${avatar.mimeType};base64,${Buffer.from(avatar.bytes).toString("base64")}` : null,
          skillCount: agent.skills.length,
          routineCount: agent.routines.length,
          memoryCount: agent.memories.length,
          fileCount: files.length,
          fileBytes: files.reduce((total, [, entry]) => total + entry.size, 0),
          nameExists: existing.has(agent.name.toLowerCase()),
        };
      }),
      warnings: bounded(warnings),
    };
  }

  discard(token: string): void {
    if (this.#staged?.token === token) this.#staged = null;
  }

  async apply(input: ApplyAgentImportInput): Promise<AgentImportResult> {
    const staged = this.#staged?.token === input.token ? this.#staged.value : null;
    this.#staged = null;
    if (!staged) throw new Error("The export is no longer open. Choose it again.");
    const selected = staged.agents.filter((agent) => input.keys.includes(agent.key));
    if (selected.length !== input.keys.length)
      throw new Error("The selection names an agent that is not in the export.");
    if (this.agents.listAgents().length + selected.length > INPUT_LIMITS.agents)
      throw new Error(`A server can have at most ${INPUT_LIMITS.agents} agents.`);

    // The archive is read again rather than held since `stage`: an export can be hundreds of MB.
    // The file can change in between, so only the same bytes are accepted.
    const bytes = await readArchive(staged.path);
    if (sha256(bytes) !== staged.sha256) throw new Error("The export changed after it was checked. Choose it again.");
    const imported: AgentSummary[] = [];
    const skipped: AgentImportSkipped[] = [];
    const warnings: string[] = [];
    for (const agent of selected) {
      try {
        imported.push(await this.importAgent(bytes, staged, agent, warnings));
      } catch (error) {
        skipped.push({ key: agent.key, name: agent.name, reason: message(error) });
      }
    }
    return { agents: imported, skipped, warnings: bounded(warnings) };
  }

  private async importAgent(
    bytes: Uint8Array,
    staged: StagedImport,
    source: ImportAgent,
    warnings: string[],
  ): Promise<AgentSummary> {
    const prefix = `${staged.wrapper}agents/${source.key}/`;
    const files = extract(bytes, (name) => name.startsWith(prefix));
    const read = (path: string) =>
      Object.entries(files)
        .filter(([name]) => name.startsWith(`${staged.wrapper}${path}/`))
        .map(([name, data]) => [name.slice(staged.wrapper.length + path.length + 1), data] as const);
    // Every skill is checked before the agent exists, so a bad one publishes nothing.
    const skills = source.skills.map((skill) => {
      const skillFiles = read(skill);
      return { files: skillFiles, slug: inspectArchive(zipSync(Object.fromEntries(skillFiles))).slug };
    });

    let agent = await this.agents.createAgentProfile({
      name: source.name,
      ...(source.title ? { title: source.title } : {}),
      description: source.description,
      avatarSeed: `${source.key}-${randomUUID()}`,
      avatarHue: null,
    });
    const published: Array<{ id: string; revision: number }> = [];
    try {
      if (source.files) await writeTree(join(agent.workspacePath, IMPORTED_FILES), read(source.files));
      for (const skill of skills) {
        const folder = `${SKILL_STAGING}/${skill.slug}`;
        const target = join(agent.workspacePath, ...folder.split("/"));
        try {
          await writeTree(target, skill.files);
          // An earlier import published this skill already: a new revision keeps one library entry.
          const library = this.skills.library();
          const current = (await library.list()).find((candidate) => candidate.slug === skill.slug);
          const revision = current
            ? await library.revise(agent.id, current.id, current.version, folder)
            : await library.create(agent.id, folder);
          published.push({ id: revision.id, revision: revision.version });
          await this.skills.installLocal({ agentId: agent.id, skillId: revision.id, revision: revision.version });
        } finally {
          await rm(target, { recursive: true, force: true });
        }
      }
      for (const routine of source.routines) {
        try {
          this.agents.createRoutine(
            {
              agentId: agent.id,
              name: routine.name,
              instruction: routine.instruction,
              active: routine.active,
              timezone: routine.timezone && validTimezone(routine.timezone) ? routine.timezone : this.timezone(),
              schedule: routine.schedule,
            },
            { recordConversationEvent: false },
          );
        } catch (error) {
          warnings.push(`${source.name}: routine "${routine.name}" is skipped. ${message(error)}`);
        }
      }
      for (const text of source.memories) this.agents.createMemory({ agentId: agent.id, text });
      const avatar = staged.avatars.get(source.key);
      if (avatar) agent = await this.agents.setAvatar(agent.id, avatar);
      return agent;
    } catch (error) {
      await this.agents.deleteAgent(agent.id).catch(() => undefined);
      // A failed import leaves the shared library as it was.
      for (const skill of published.reverse())
        await this.skills
          .library()
          .withdraw(skill.id, skill.revision)
          .catch(() => undefined);
      throw error;
    }
  }
}

async function readArchive(path: string): Promise<Uint8Array> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("Choose a .zip file.");
  if (info.size === 0 || info.size > AGENT_IMPORT_LIMITS.archiveBytes)
    throw new Error("The export must be a .zip under 500 MB.");
  return new Uint8Array(await readFile(path));
}

/** Every file entry and its expanded size, checked, without inflating anything. */
function listEntries(bytes: Uint8Array): Map<string, StagedEntry> {
  const entries = new Map<string, StagedEntry>();
  let expanded = 0;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        const name = file.name.replaceAll("\\", "/");
        if (name.endsWith("/")) return false;
        if (isUnsafeEntry(name)) throw new UnsafeEntry(name);
        expanded += file.originalSize;
        if (entries.size >= AGENT_IMPORT_LIMITS.files || expanded > AGENT_IMPORT_LIMITS.archiveBytes)
          throw new UnsafeEntry(null);
        entries.set(name, { size: file.originalSize });
        return false;
      },
    });
  } catch (error) {
    if (error instanceof UnsafeEntry)
      throw new Error(
        error.entry
          ? `The export contains an unsafe file: ${error.entry}`
          : `The export must expand to under 500 MB and ${AGENT_IMPORT_LIMITS.files} files.`,
      );
    // A zip that Grok Bot is still writing has no central directory yet, so it reads as invalid.
    throw new Error("The selected file is not a valid .zip. If Grok Bot is still saving it, wait and choose it again.");
  }
  if (!entries.size) throw new Error("The export is empty.");
  return entries;
}

/** Inflates the file entries `include` names. A directory entry is never inflated. */
function extract(bytes: Uint8Array, include: (name: string) => boolean): Record<string, Uint8Array> {
  const raw = unzipSync(bytes, {
    filter: (file) => {
      const name = file.name.replaceAll("\\", "/");
      return !name.endsWith("/") && include(name);
    },
  });
  return Object.fromEntries(Object.entries(raw).map(([name, data]) => [name.replaceAll("\\", "/"), data]));
}

/** A segment such as `D:` names another Windows drive, so `resolve` would leave the target folder. */
function isUnsafeEntry(name: string): boolean {
  return isUnsafeArchivePath(name) || name.split("/").some((part) => /^[a-z]:/iu.test(part));
}

class UnsafeEntry extends Error {
  constructor(readonly entry: string | null) {
    super("Unsafe archive entry.");
  }
}

/** A zip made by compressing a folder puts everything in that folder. */
function wrapperFolder(names: string[]): string {
  if (names.includes(AGENT_IMPORT_MANIFEST)) return "";
  const roots = new Set(names.map((name) => name.split("/")[0]));
  const [root] = roots;
  return roots.size === 1 && root && names.every((name) => name.includes("/")) ? `${root}/` : "";
}

function filesUnder(entries: Map<string, StagedEntry>, folder: string): Array<[string, StagedEntry]> {
  return [...entries].filter(([name]) => name.startsWith(`${folder}/`));
}

async function writeTree(root: string, files: ReadonlyArray<readonly [string, Uint8Array]>): Promise<void> {
  const base = resolve(root);
  for (const [name, data] of files) {
    const target = resolve(base, name);
    if (isAbsolute(name) || isUnsafeEntry(name) || target === base || !isPathInside(base, target))
      throw new Error(`The export contains an unsafe file: ${name}`);
    await mkdir(dirname(target), { recursive: true });
    // `wx` refuses to replace a file, so an entry can never overwrite what is already there.
    await writeFile(target, data, { flag: "wx" });
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function avatarImage(bytes: Uint8Array | undefined): AvatarImageInput | null {
  if (!bytes) return null;
  const mimeType = AVATAR_MIME_TYPES.find((type) => isValidAvatarImage(type, bytes));
  return mimeType ? { mimeType, bytes } : null;
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function bounded(warnings: string[]): string[] {
  return warnings.slice(0, AGENT_IMPORT_LIMITS.warnings).map((text) => text.slice(0, AGENT_IMPORT_LIMITS.message));
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : "The import failed.";
  return text.slice(0, AGENT_IMPORT_LIMITS.message);
}
