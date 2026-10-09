import { Deferred, Effect, Exit, Result, Schema } from "effect";
import { type ArchiveOperationError, archiveCall, archiveFailure, archiveResult, archiveSync } from "./archive-effects";
// Agent import into this host from one `.zip` export: chosen by the local user, or sent by a member
// of a joined client with `agent-import-v1`.
//
// `stage` reads only the manifest and the avatars and measures the other entries without
// inflating them, so a large export previews quickly. `apply` inflates one agent at a time.
// Each agent is created through the same services the user reaches by hand. When one step fails,
// that agent is deleted and reported, and the other agents continue. A workspace file that cannot
// be written is a warning, not a failed step, so the agent still imports. Group chats become channels
// after the agents, with the members that imported; a channel needs at least one, as in OpenBot.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
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
  type ChannelCommand,
  type ChannelDraft,
  type CreateChannelMemoryInput,
  type CreateChannelRoutineInput,
  type CreateRoutineInput,
  isChannelDraft,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { unzipSync, zipSync } from "fflate";
import type { AgentService } from "../backend/agent-service";
import type { ChannelService } from "../backend/channel-service";
import { runCauseEffect } from "../backend/effect-boundary";
import { isPathInside } from "../backend/path-containment";
import {
  AGENT_IMPORT_MANIFEST,
  decodeImportManifest,
  type ImportAgent,
  type ImportChannel,
} from "./agent-import-manifest";
import { validTimezone } from "./agent-marketplace-service";
import type { LocalSkillLibrary } from "./local-skill-library";
import type { SkillMarketplaceFailure } from "./skill-marketplace-service";
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
  }): ReturnType<AgentService["createAgentProfile"]>;
  createRoutine(input: CreateRoutineInput, options?: { recordConversationEvent?: boolean }): unknown;
  createMemory(input: { agentId: string; text: string }): unknown;
  memoryLimit(): number;
  setAvatar(agentId: string, image: AvatarImageInput | null): ReturnType<AgentService["setAvatar"]>;
  deleteAgent(agentId: string): ReturnType<AgentService["deleteAgent"]>;
  channels: { command(command: ChannelCommand, actor: ChannelActor): ReturnType<ChannelService["command"]> };
  createChannelMemory(input: CreateChannelMemoryInput): unknown;
  createChannelRoutine(input: CreateChannelRoutineInput): unknown;
  deleteChannel(channelId: string): ReturnType<AgentService["deleteChannel"]>;
}

/** Who creates an imported channel: the local user or the member who imports, as when they create one by hand. */
export interface ChannelActor {
  id: string;
  name: string;
}

export interface AgentImportSkills {
  library(): Pick<LocalSkillLibrary, "list" | "create" | "revise" | "withdraw">;
  installLocal(input: {
    agentId: string;
    skillId: string;
    revision: number;
  }): Effect.Effect<unknown, SkillMarketplaceFailure>;
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

interface StagedSlot {
  /** Only the owner can apply or discard the token. */
  owner: string;
  value: StagedImport;
  /** An uploaded export: the service wrote the file and removes it. */
  temporary: boolean;
  /** Releases an uploaded export nobody applied or discarded. */
  expiry: ReturnType<typeof setTimeout> | null;
}

/** Who applies an export: the local user, or a member of a joined client. */
export interface AgentImportCaller {
  owner: string;
  actor: ChannelActor;
  /** The caller's zone, for a routine the export gives none. */
  timezone?: string;
  /** False for a member: a skill already in the library is installed as it is, never revised. */
  reviseSkills: boolean;
}

interface ImportContext {
  actor: ChannelActor;
  timezone: string;
  reviseSkills: boolean;
}

/** The owner of the exports the local user stages. A member's owner is the member id. */
const LOCAL_IMPORT_OWNER = "local";
/** Uploaded exports kept at one time, across all members. */
const UPLOAD_SLOTS = 4;
/** An uploaded export nobody applied is released after this. */
const UPLOAD_TTL_MS = 30 * 60_000;

export class AgentImportService {
  readonly #staged = new Map<string, StagedSlot>();
  /** Uploaded files that are not in `#staged`: being staged, or being applied. */
  #busyUploads = 0;
  /** Files left by an earlier run are removed before the first upload. */
  #uploadDirectoryReady: Deferred.Deferred<void, ArchiveOperationError> | null = null;

  constructor(
    private readonly agents: AgentImportAgents,
    private readonly skills: AgentImportSkills,
    private readonly channelActor: () => ChannelActor,
    private readonly timezone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    private readonly uploadDirectory: string | null = null,
  ) {}

  /** Reads and checks an export. A new stage by the same owner replaces the owner's previous one. */
  readonly stage = Effect.fn("AgentImportService.stage")(function* (
    this: AgentImportService,
    path: string,
    owner = LOCAL_IMPORT_OWNER,
  ) {
    yield* this.#release(owner);
    return yield* this.#stageFile(path, owner, false);
  }).bind(this);

  readonly stageUpload = Effect.fn("AgentImportService.stageUpload")(function* (
    this: AgentImportService,
    read: () => Promise<Uint8Array>,
    owner: string,
  ): Effect.fn.Return<AgentImportPreview, ArchiveOperationError> {
    const directory = this.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Agent import uploads are not available."));
    yield* this.#release(owner);
    const held = [...this.#staged.values()].filter((slot) => slot.temporary).length;
    if (held + this.#busyUploads >= UPLOAD_SLOTS)
      return yield* archiveFailure(new Error(sourceText("error.import.hostBusy")));
    this.#busyUploads += 1;
    return yield* Effect.gen({ self: this }, function* () {
      const bytes = yield* archiveCall(() => read());
      yield* this.#prepareUploadDirectory(directory);
      const path = join(directory, `${randomUUID()}.zip`);
      let retained = false;
      return yield* Effect.acquireUseRelease(
        Effect.succeed(path),
        () =>
          Effect.gen({ self: this }, function* () {
            yield* archiveCall(() => writeFile(path, bytes, { flag: "wx", mode: 0o600 })).pipe(Effect.uninterruptible);
            const preview = yield* this.#stageFile(path, owner, true);
            retained = true;
            return preview;
          }),
        () => (retained ? Effect.void : archiveCall(() => rm(path, { force: true }))),
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#busyUploads -= 1;
        }),
      ),
    );
  }).bind(this);

  readonly #prepareUploadDirectory = Effect.fn("AgentImportService.prepareUploadDirectory")(function* (
    this: AgentImportService,
    directory: string,
  ) {
    if (this.#uploadDirectoryReady) return yield* Deferred.await(this.#uploadDirectoryReady);
    const ready = Deferred.makeUnsafe<void, ArchiveOperationError>();
    this.#uploadDirectoryReady = ready;
    const exit = yield* Effect.exit(
      Effect.gen(function* () {
        yield* archiveCall(() => rm(directory, { recursive: true, force: true }));
        yield* archiveCall(() => mkdir(directory, { recursive: true, mode: 0o700 }));
      }),
    );
    yield* Deferred.done(ready, exit);
    if (Exit.isFailure(exit)) this.#uploadDirectoryReady = null;
    return yield* exit;
  }, Effect.uninterruptible);

  readonly #stageFile = Effect.fn("AgentImportService.stageFile")(function* (
    this: AgentImportService,
    path: string,
    owner: string,
    temporary: boolean,
  ): Effect.fn.Return<AgentImportPreview, ArchiveOperationError> {
    const bytes = yield* readArchiveEffect(path);
    const entries = yield* archiveSync(() => listEntries(bytes));
    const wrapper = wrapperFolder([...entries.keys()]);
    const inner = new Map([...entries].map(([name, entry]) => [name.slice(wrapper.length), entry]));
    const manifestName = `${wrapper}${AGENT_IMPORT_MANIFEST}`;
    if (!entries.has(manifestName))
      return yield* archiveFailure(
        new Error(sourceText("error.import.manifestMissing", { manifest: AGENT_IMPORT_MANIFEST })),
      );
    const { manifest, warnings } = yield* archiveSync(() =>
      decodeImportManifest(
        extract(bytes, (name) => name === manifestName)[manifestName] ?? new Uint8Array(),
        this.agents.memoryLimit(),
      ),
    );

    const avatarPaths = new Set(manifest.agents.flatMap((agent) => (agent.avatar ? [wrapper + agent.avatar] : [])));
    const avatarBytes = yield* archiveSync(() => extract(bytes, (name) => avatarPaths.has(name)));
    const avatars = new Map<string, AvatarImageInput>();
    const existing = new Set(this.agents.listAgents().map((agent) => agent.name.toLowerCase()));
    for (const agent of manifest.agents) {
      for (const skill of agent.skills)
        if (!inner.has(`${skill}/SKILL.md`))
          return yield* archiveFailure(
            new Error(sourceText("error.import.skillFolderMissing", { name: agent.name, skill })),
          );
      if (agent.avatar) {
        const image = avatarImage(avatarBytes[wrapper + agent.avatar]);
        if (image) avatars.set(agent.key, image);
        else warnings.push(sourceText("error.import.avatarSkipped", { name: agent.name }));
      }
    }

    const token = randomUUID();
    // A second stage by the same owner can finish first: the owner keeps one export.
    yield* this.#release(owner);
    const slot: StagedSlot = {
      owner,
      value: { path, sha256: sha256(bytes), agents: manifest.agents, channels: manifest.channels, wrapper, avatars },
      temporary,
      expiry: null,
    };
    if (temporary) {
      slot.expiry = setTimeout(() => {
        void runCauseEffect(this.#drop(token, slot));
      }, UPLOAD_TTL_MS);
      slot.expiry.unref();
    }
    this.#staged.set(token, slot);
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
  });

  readonly discard = Effect.fn("AgentImportService.discard")(function* (
    this: AgentImportService,
    token: string,
    owner = LOCAL_IMPORT_OWNER,
  ) {
    const slot = this.#staged.get(token);
    if (slot && slot.owner === owner) yield* this.#drop(token, slot);
  }).bind(this);

  readonly apply = Effect.fn("AgentImportService.apply")(function* (
    this: AgentImportService,
    input: ApplyAgentImportInput,
    caller?: AgentImportCaller,
  ): Effect.fn.Return<AgentImportResult, ArchiveOperationError> {
    const slot = this.#staged.get(input.token);
    // Another member's token reads as a closed export, so the answer does not show that it exists.
    if (!slot || slot.owner !== (caller?.owner ?? LOCAL_IMPORT_OWNER))
      return yield* archiveFailure(new Error(sourceText("error.import.exportClosed")));
    this.#staged.delete(input.token);
    if (slot.expiry) clearTimeout(slot.expiry);
    // The file stays on disk until the import ends, so it keeps its upload slot until then.
    if (slot.temporary) this.#busyUploads += 1;
    return yield* Effect.gen({ self: this }, function* () {
      return yield* this.#importSelected(slot.value, input, {
        actor: caller?.actor ?? this.channelActor(),
        timezone: caller?.timezone && validTimezone(caller.timezone) ? caller.timezone : this.timezone(),
        reviseSkills: caller?.reviseSkills ?? true,
      });
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          if (slot.temporary) {
            yield* archiveCall(() => rm(slot.value.path, { force: true }).catch(() => undefined));
            this.#busyUploads -= 1;
          }
        }).pipe(Effect.orDie),
      ),
    );
  }).bind(this);

  readonly #release = Effect.fn("AgentImportService.release")(function* (this: AgentImportService, owner: string) {
    for (const [token, slot] of this.#staged) if (slot.owner === owner) yield* this.#drop(token, slot);
  });

  readonly #drop = Effect.fn("AgentImportService.drop")(function* (
    this: AgentImportService,
    token: string,
    slot: StagedSlot,
  ) {
    if (this.#staged.get(token) !== slot) return;
    this.#staged.delete(token);
    if (slot.expiry) clearTimeout(slot.expiry);
    if (slot.temporary) yield* archiveCall(() => rm(slot.value.path, { force: true })).pipe(Effect.ignore);
  });

  readonly #importSelected = Effect.fn("AgentImportService.importSelected")(function* (
    this: AgentImportService,
    staged: StagedImport,
    input: ApplyAgentImportInput,
    context: ImportContext,
  ): Effect.fn.Return<AgentImportResult, ArchiveOperationError> {
    const selected = staged.agents.filter((agent) => input.keys.includes(agent.key));
    if (selected.length !== input.keys.length)
      return yield* archiveFailure(new Error(sourceText("error.import.agentNotInExport")));
    const selectedChannels = staged.channels.filter((channel) => input.channelKeys.includes(channel.key));
    if (selectedChannels.length !== input.channelKeys.length)
      return yield* archiveFailure(new Error(sourceText("error.import.channelNotInExport")));
    if (this.agents.listAgents().length + selected.length > INPUT_LIMITS.agents)
      return yield* archiveFailure(
        new Error(sourceText("error.import.serverAgentLimit", { limit: INPUT_LIMITS.agents })),
      );

    // The archive is read again rather than held since `stage`: an export can be hundreds of MB.
    // The file can change in between, so only the same bytes are accepted.
    const bytes = yield* readArchiveEffect(staged.path);
    if (sha256(bytes) !== staged.sha256)
      return yield* archiveFailure(new Error(sourceText("error.import.exportChanged")));
    const imported: AgentSummary[] = [];
    const skipped: AgentImportSkipped[] = [];
    const warnings: string[] = [];
    const agentIds = new Map<string, string>();
    for (const agent of selected) {
      const importedAgent = yield* Effect.result(this.#importAgent(bytes, staged, agent, context, warnings));
      if (Result.isFailure(importedAgent)) {
        skipped.push({ key: agent.key, name: agent.name, reason: message(importedAgent.failure.cause) });
      } else {
        imported.push(importedAgent.success);
        agentIds.set(agent.key, importedAgent.success.id);
      }
    }
    const channels: AgentImportChannel[] = [];
    const skippedChannels: AgentImportSkipped[] = [];
    for (const channel of selectedChannels) {
      const importedChannel = yield* Effect.result(this.#importChannel(channel, agentIds, context, warnings));
      if (Result.isFailure(importedChannel)) {
        skippedChannels.push({ key: channel.key, name: channel.name, reason: message(importedChannel.failure.cause) });
      } else channels.push(importedChannel.success);
    }
    return { agents: imported, skipped, channels, skippedChannels, warnings: bounded(warnings) };
  });

  readonly #importChannel = Effect.fn("AgentImportService.importChannel")(function* (
    this: AgentImportService,
    source: ImportChannel,
    agentIds: ReadonlyMap<string, string>,
    context: ImportContext,
    warnings: string[],
  ): Effect.fn.Return<AgentImportChannel, ArchiveOperationError> {
    const members = source.members.flatMap((key) => {
      const agentId = agentIds.get(key);
      return agentId ? [{ agentId }] : [];
    });
    if (members.length === 0) return yield* archiveFailure(new Error(sourceText("error.import.noMembersImported")));
    const leadAgentId = source.lead ? (agentIds.get(source.lead) ?? null) : null;
    if (source.lead && !leadAgentId) warnings.push(sourceText("error.import.leadNotImported", { name: source.name }));
    const draft: ChannelDraft = {
      name: source.name,
      title: source.title,
      instructions: source.instructions,
      members,
      leadAgentId,
    };
    if (!isChannelDraft(draft)) return yield* archiveFailure(new Error("The channel is invalid."));

    let completed = false;
    return yield* Effect.acquireUseRelease(
      this.agents.channels
        .command({ type: "save", operationId: randomUUID(), channelId: randomUUID(), draft }, context.actor)
        .pipe(Effect.mapError((error) => archiveFailure(error.cause))),
      (created) =>
        Effect.gen({ self: this }, function* () {
          const channel = created;
          try {
            for (const text of source.memories) this.agents.createChannelMemory({ channelId: channel.id, text });
            for (const routine of source.routines) {
              try {
                this.agents.createChannelRoutine({
                  channelId: channel.id,
                  name: routine.name,
                  instruction: routine.instruction,
                  active: routine.active,
                  timezone: routine.timezone && validTimezone(routine.timezone) ? routine.timezone : context.timezone,
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
            completed = true;
            return { id: channel.id, name: channel.name };
          } catch (error) {
            return yield* archiveFailure(error);
          }
        }),
      (channel) =>
        completed
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              yield* this.agents.deleteChannel(channel.id).pipe(Effect.ignore);
            }).pipe(Effect.orDie),
    );
  });

  readonly #importAgent = Effect.fn("AgentImportService.importAgent")(function* (
    this: AgentImportService,
    bytes: Uint8Array,
    staged: StagedImport,
    source: ImportAgent,
    context: ImportContext,
    warnings: string[],
  ): Effect.fn.Return<AgentSummary, ArchiveOperationError> {
    const prefix = `${staged.wrapper}agents/${source.key}/`;
    const files = yield* archiveSync(() => extract(bytes, (name) => name.startsWith(prefix)));
    const read = (path: string) =>
      Object.entries(files)
        .filter(([name]) => name.startsWith(`${staged.wrapper}${path}/`))
        .map(([name, data]) => [name.slice(staged.wrapper.length + path.length + 1), data] as const);
    // Every skill is checked before the agent exists, so a bad one publishes nothing.
    const skills = yield* archiveSync(() =>
      source.skills.map((skill) => {
        const skillFiles = read(skill);
        return { files: skillFiles, slug: inspectArchive(zipSync(Object.fromEntries(skillFiles))).slug };
      }),
    );

    const published: Array<{ id: string; revision: number }> = [];
    let completed = false;
    return yield* Effect.acquireUseRelease(
      this.agents
        .createAgentProfile({
          name: source.name,
          ...(source.title ? { title: source.title } : {}),
          description: source.description,
          avatarSeed: `${source.key}-${randomUUID()}`,
          avatarHue: null,
        })
        .pipe(Effect.mapError((error) => archiveFailure(error.cause))),
      (created) =>
        Effect.gen({ self: this }, function* () {
          let agent = created;
          try {
            if (source.files)
              yield* writeImportedFilesEffect(
                join(agent.workspacePath, IMPORTED_FILES),
                read(source.files),
                source.name,
                warnings,
              );
            for (const skill of skills) {
              const library = this.skills.library();
              const current = (yield* library
                .list()
                .pipe(Effect.mapError((error) => archiveFailure(error.cause)))).find(
                (candidate) => candidate.slug === skill.slug,
              );
              if (current && !context.reviseSkills) {
                warnings.push(sourceText("error.import.skillKept", { name: source.name, skill: skill.slug }));
                yield* this.skills
                  .installLocal({ agentId: agent.id, skillId: current.id, revision: current.version })
                  .pipe(Effect.mapError((error) => archiveFailure(error.cause)))
                  .pipe(Effect.uninterruptible);
                continue;
              }
              const folder = `${SKILL_STAGING}/${skill.slug}`;
              const target = join(agent.workspacePath, ...folder.split("/"));
              yield* Effect.acquireUseRelease(
                Effect.succeed(target),
                () =>
                  Effect.gen({ self: this }, function* () {
                    yield* writeTreeEffect(target, skill.files);
                    // A new revision retains the existing library entry.
                    const revision = yield* Effect.gen(function* () {
                      const revision = yield* (
                        current
                          ? library.revise(agent.id, current.id, current.version, folder)
                          : library.create(agent.id, folder)
                      ).pipe(Effect.mapError((error) => archiveFailure(error.cause)));
                      published.push({ id: revision.id, revision: revision.version });
                      return revision;
                    }).pipe(Effect.uninterruptible);
                    yield* this.skills
                      .installLocal({
                        agentId: agent.id,
                        skillId: revision.id,
                        revision: revision.version,
                      })
                      .pipe(Effect.mapError((error) => archiveFailure(error.cause)))
                      .pipe(Effect.uninterruptible);
                  }),
                () => archiveCall(() => rm(target, { recursive: true, force: true })),
              );
            }

            for (const routine of source.routines) {
              try {
                this.agents.createRoutine(
                  {
                    agentId: agent.id,
                    name: routine.name,
                    instruction: routine.instruction,
                    active: routine.active,
                    timezone: routine.timezone && validTimezone(routine.timezone) ? routine.timezone : context.timezone,
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
            if (avatar)
              agent = yield* this.agents
                .setAvatar(agent.id, avatar)
                .pipe(Effect.mapError((error) => archiveFailure(error.cause)))
                .pipe(Effect.uninterruptible);
            completed = true;
            return agent;
          } catch (error) {
            return yield* archiveFailure(error);
          }
        }),
      (agent) =>
        completed
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              yield* this.agents.deleteAgent(agent.id).pipe(Effect.ignore);
              for (const skill of published.reverse())
                yield* this.skills.library().withdraw(skill.id, skill.revision).pipe(Effect.ignore);
            }).pipe(Effect.orDie),
    );
  });
}

const readArchiveEffect = Effect.fn("Archive.readArchive")(function* (
  path: string,
): Effect.fn.Return<Uint8Array, ArchiveOperationError> {
  const info = yield* archiveCall(() => stat(path));
  if (!info.isFile()) return yield* archiveFailure(new Error(sourceText("error.import.chooseZip")));
  if (info.size === 0 || info.size > AGENT_IMPORT_LIMITS.archiveBytes)
    return yield* archiveFailure(new Error(sourceText("error.import.zipTooLarge")));
  return new Uint8Array(yield* archiveCall(() => readFile(path)));
});

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

class UnsafeEntry extends Schema.TaggedError<UnsafeEntry>()("UnsafeEntry", {
  entry: Schema.NullOr(Schema.String),
  message: Schema.String,
}) {
  constructor(entry: string | null) {
    super({ entry, message: "Unsafe archive entry." });
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

const writeTreeEffect = Effect.fn("Archive.writeTree")(function* (
  root: string,
  files: ReadonlyArray<readonly [string, Uint8Array]>,
): Effect.fn.Return<void, ArchiveOperationError> {
  const base = resolve(root);
  for (const [name, data] of files) {
    const target = resolve(base, name);
    if (isAbsolute(name) || isUnsafeEntry(name) || target === base || !isPathInside(base, target))
      return yield* archiveFailure(new Error(sourceText("error.import.unsafeFile", { name })));
    yield* archiveCall(() => mkdir(dirname(target), { recursive: true })).pipe(Effect.uninterruptible);
    // `wx` refuses to replace a file, so an entry can never overwrite what is already there.
    yield* archiveCall(() => writeFile(target, data, { flag: "wx" })).pipe(Effect.uninterruptible);
  }
});

/**
 * Writes the workspace files of one agent and never replaces a file. When a file is already there,
 * for example `README.md` and `readme.md` on a disk that ignores case, the entry is saved beside it
 * as `README (2).md`. A file that still cannot be written is skipped. Each case adds a warning.
 */
const writeImportedFilesEffect = Effect.fn("Archive.writeImportedFiles")(function* (
  root: string,
  files: ReadonlyArray<readonly [string, Uint8Array]>,
  agentName: string,
  warnings: string[],
): Effect.fn.Return<void, ArchiveOperationError> {
  const base = resolve(root);
  for (const [name, data] of files) {
    const target = resolve(base, name);
    if (isAbsolute(name) || isUnsafeEntry(name) || target === base || !isPathInside(base, target))
      return yield* archiveFailure(new Error(sourceText("error.import.unsafeFile", { name })));
    try {
      archiveResult(
        yield* Effect.result(
          archiveCall(() => mkdir(dirname(target), { recursive: true })).pipe(Effect.uninterruptible),
        ),
      );
      for (let copy = 1; ; copy += 1) {
        try {
          archiveResult(
            yield* Effect.result(
              archiveCall(() => writeFile(copy === 1 ? target : copyName(target, copy), data, { flag: "wx" })).pipe(
                Effect.uninterruptible,
              ),
            ),
          );
          if (copy > 1)
            warnings.push(
              sourceText("error.import.fileRenamed", { name: agentName, file: name, saved: copyName(name, copy) }),
            );
          break;
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
      }
    } catch (error) {
      warnings.push(sourceText("error.import.fileSkipped", { name: agentName, file: name, reason: message(error) }));
    }
  }
});

/** `notes/plan.md` becomes `notes/plan (2).md`. */
function copyName(path: string, copy: number): string {
  const extension = extname(path);
  return `${path.slice(0, path.length - extension.length)} (${copy})${extension}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function avatarImage(bytes: Uint8Array | undefined): AvatarImageInput | null {
  if (!bytes) return null;
  const mimeType = AVATAR_MIME_TYPES.find((type) => isValidAvatarImage(type, bytes));
  return mimeType ? { mimeType, bytes } : null;
}

function bounded(warnings: string[]): string[] {
  return warnings.slice(0, AGENT_IMPORT_LIMITS.warnings).map((text) => text.slice(0, AGENT_IMPORT_LIMITS.message));
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : "The import failed.";
  return text.slice(0, AGENT_IMPORT_LIMITS.message);
}
