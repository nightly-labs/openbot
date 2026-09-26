// Agent import into the local host from one `.zip` export.
//
// `stage` reads only the manifest and the avatars and measures the other entries without
// inflating them, so a large export previews quickly. `apply` inflates one agent at a time.
// Each agent is created through the same services the user reaches by hand. When one step fails,
// that agent is deleted and reported, and the other agents continue. Group chats become channels
// after the agents, with the members that imported; a channel needs at least one, as in OpenBot.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { AVATAR_MIME_TYPES, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_IMPORT_LIMITS,
  type AgentImportChannel,
  type AgentImportPreview,
  type AgentImportResult,
  type AgentImportSkipped,
  type AgentSummary,
  type ApplyAgentImportInput,
  type AvatarImageInput,
  type Channel,
  type ChannelCommand,
  type ChannelDraft,
  type CreateChannelMemoryInput,
  type CreateChannelRoutineInput,
  type CreateRoutineInput,
  isChannelDraft,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { unzipSync, zipSync } from "fflate";
import { isPathInside } from "../backend/path-containment";
import {
  AGENT_IMPORT_MANIFEST,
  decodeImportManifest,
  type ImportAgent,
  type ImportChannel,
} from "./agent-import-manifest";
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
  channels: { command(command: ChannelCommand, actor: ChannelActor): Promise<Channel> };
  createChannelMemory(input: CreateChannelMemoryInput): unknown;
  createChannelRoutine(input: CreateChannelRoutineInput): unknown;
  deleteChannel(channelId: string): Promise<void>;
}

/** Who creates an imported channel: the local user, as when they create one by hand. */
export interface ChannelActor {
  id: string;
  name: string;
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
  channels: ImportChannel[];
  wrapper: string;
  avatars: Map<string, AvatarImageInput>;
}

export class AgentImportService {
  #staged: { token: string; value: StagedImport } | null = null;

  constructor(
    private readonly agents: AgentImportAgents,
    private readonly skills: AgentImportSkills,
    private readonly channelActor: () => ChannelActor,
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
    if (!entries.has(manifestName))
      throw new Error(sourceText("error.import.manifestMissing", { manifest: AGENT_IMPORT_MANIFEST }));
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
          throw new Error(sourceText("error.import.skillFolderMissing", { name: agent.name, skill }));
      if (agent.avatar) {
        const image = avatarImage(avatarBytes[wrapper + agent.avatar]);
        if (image) avatars.set(agent.key, image);
        else warnings.push(sourceText("error.import.avatarSkipped", { name: agent.name }));
      }
    }

    const token = randomUUID();
    this.#staged = {
      token,
      value: { path, sha256: sha256(bytes), agents: manifest.agents, channels: manifest.channels, wrapper, avatars },
    };
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
      channels: manifest.channels.map((channel) => ({
        key: channel.key,
        name: channel.name,
        title: channel.title,
        memberKeys: channel.members,
        leadKey: channel.lead,
        memoryCount: channel.memories.length,
        routineCount: channel.routines.length,
      })),
      warnings: bounded(warnings),
    };
  }

  discard(token: string): void {
    if (this.#staged?.token === token) this.#staged = null;
  }

  async apply(input: ApplyAgentImportInput): Promise<AgentImportResult> {
    const staged = this.#staged?.token === input.token ? this.#staged.value : null;
    this.#staged = null;
    if (!staged) throw new Error(sourceText("error.import.exportClosed"));
    const selected = staged.agents.filter((agent) => input.keys.includes(agent.key));
    if (selected.length !== input.keys.length) throw new Error(sourceText("error.import.agentNotInExport"));
    const selectedChannels = staged.channels.filter((channel) => input.channelKeys.includes(channel.key));
    if (selectedChannels.length !== input.channelKeys.length)
      throw new Error(sourceText("error.import.channelNotInExport"));
    if (this.agents.listAgents().length + selected.length > INPUT_LIMITS.agents)
      throw new Error(sourceText("error.import.serverAgentLimit", { limit: INPUT_LIMITS.agents }));

    // The archive is read again rather than held since `stage`: an export can be hundreds of MB.
    // The file can change in between, so only the same bytes are accepted.
    const bytes = await readArchive(staged.path);
    if (sha256(bytes) !== staged.sha256) throw new Error(sourceText("error.import.exportChanged"));
    const imported: AgentSummary[] = [];
    const skipped: AgentImportSkipped[] = [];
    const warnings: string[] = [];
    const agentIds = new Map<string, string>();
    for (const agent of selected) {
      try {
        const summary = await this.importAgent(bytes, staged, agent, warnings);
        imported.push(summary);
        agentIds.set(agent.key, summary.id);
      } catch (error) {
        skipped.push({ key: agent.key, name: agent.name, reason: message(error) });
      }
    }
    const channels: AgentImportChannel[] = [];
    const skippedChannels: AgentImportSkipped[] = [];
    for (const channel of selectedChannels) {
      try {
        channels.push(await this.importChannel(channel, agentIds, warnings));
      } catch (error) {
        skippedChannels.push({ key: channel.key, name: channel.name, reason: message(error) });
      }
    }
    return { agents: imported, skipped, channels, skippedChannels, warnings: bounded(warnings) };
  }

  private async importChannel(
    source: ImportChannel,
    agentIds: ReadonlyMap<string, string>,
    warnings: string[],
  ): Promise<AgentImportChannel> {
    const members = source.members.flatMap((key) => {
      const agentId = agentIds.get(key);
      return agentId ? [{ agentId }] : [];
    });
    if (members.length === 0) throw new Error(sourceText("error.import.noMembersImported"));
    const leadAgentId = source.lead ? (agentIds.get(source.lead) ?? null) : null;
    if (source.lead && !leadAgentId) warnings.push(sourceText("error.import.leadNotImported", { name: source.name }));
    const draft: ChannelDraft = {
      name: source.name,
      title: source.title,
      instructions: source.instructions,
      members,
      leadAgentId,
    };
    if (!isChannelDraft(draft)) throw new Error("The channel is invalid.");
    const channel = await this.agents.channels.command(
      { type: "save", operationId: randomUUID(), channelId: randomUUID(), draft },
      this.channelActor(),
    );
    try {
      for (const text of source.memories) this.agents.createChannelMemory({ channelId: channel.id, text });
      for (const routine of source.routines) {
        try {
          this.agents.createChannelRoutine({
            channelId: channel.id,
            name: routine.name,
            instruction: routine.instruction,
            active: routine.active,
            timezone: routine.timezone && validTimezone(routine.timezone) ? routine.timezone : this.timezone(),
            schedule: routine.schedule,
          });
        } catch (error) {
          warnings.push(
            sourceText("error.import.routineSkipped", {
              name: source.name,
              routine: routine.name,
              reason: message(error),
            }),
          );
        }
      }
      return { id: channel.id, name: channel.name };
    } catch (error) {
      await this.agents.deleteChannel(channel.id).catch(() => undefined);
      throw error;
    }
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
          warnings.push(
            sourceText("error.import.routineSkipped", {
              name: source.name,
              routine: routine.name,
              reason: message(error),
            }),
          );
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
  if (!info.isFile()) throw new Error(sourceText("error.import.chooseZip"));
  if (info.size === 0 || info.size > AGENT_IMPORT_LIMITS.archiveBytes)
    throw new Error(sourceText("error.import.zipTooLarge"));
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
          ? sourceText("error.import.unsafeFile", { name: error.entry })
          : sourceText("error.import.expandedTooLarge", { limit: AGENT_IMPORT_LIMITS.files }),
      );
    // A zip that Grok Bot is still writing has no central directory yet, so it reads as invalid.
    throw new Error(sourceText("error.import.zipInvalid"));
  }
  if (!entries.size) throw new Error(sourceText("error.import.empty"));
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
      throw new Error(sourceText("error.import.unsafeFile", { name }));
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
