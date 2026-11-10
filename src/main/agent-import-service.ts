import { Deferred, Effect, Exit, Result } from "effect";
import { zipSync } from "fflate";
import { parseDocument } from "yaml";
import { type ArchiveOperationError, archiveCall, archiveFailure, archiveSync } from "./archive-effects";
// Agent import into this host from one `.zip` export: chosen by the local user, or sent by a member
// of a joined client with `agent-import-v1`, or in parts with `agent-import-v2`.
//
// `stage` reads only the manifest and the avatars and measures the other entries without
// inflating them, so a large export previews quickly. `apply` inflates one agent at a time.
// Each agent is created through the same services the user reaches by hand. When one step fails,
// that agent is deleted and reported, and the other agents continue. A workspace file that cannot
// be written is a warning, not a failed step, so the agent still imports. Group chats become channels
// after the agents, with the members that imported; a channel needs at least one, as in OpenBot.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AVATAR_IMAGE_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
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
import type { AgentService } from "../backend/agent-service";
import type { ChannelService } from "../backend/channel-service";
import { runCauseEffect } from "../backend/effect-boundary";
import { diskSpace } from "../backend/storage-usage";
import {
  type ArchiveEntry,
  type ArchiveFile,
  type ArchiveLimits,
  avatarImage,
  MANIFEST_MAX_BYTES,
  readArchiveEffect,
  readEntriesEffect,
  readSkillEffect,
  writeImportedFilesEffect,
  writeTreeEffect,
} from "./agent-archive";
import {
  AGENT_IMPORT_MANIFEST,
  decodeImportManifest,
  type ImportAgent,
  type ImportChannel,
} from "./agent-import-manifest";
import { validTimezone } from "./agent-marketplace-service";
import type { LocalSkillLibrary } from "./local-skill-library";
import type { SkillMarketplaceFailure } from "./skill-marketplace-service";
import { inspectArchive, SKILL_FRONTMATTER } from "./skill-package";

/** Skill folders are copied here, published to the local library, and removed again. */
const SKILL_STAGING = ".openbot/import-skills";
/** Workspace files of an imported agent go under this folder, so they never replace OpenBot's own. */
const IMPORTED_FILES = "imported";
/** Archive limits and the errors that name them. */
const IMPORT_ARCHIVE: ArchiveLimits = {
  files: AGENT_IMPORT_LIMITS.files,
  expandedTooLarge: sourceText("error.import.tooManyFiles", { limit: AGENT_IMPORT_LIMITS.files }),
  invalid: sourceText("error.import.zipInvalid"),
};
/**
 * A member's export, sent to this host. `agent-import-v1` limits the upload to 100 MB, and its
 * expanded size keeps the limits it had before, so a small upload cannot inflate up to 2 GB.
 */
const REMOTE_IMPORT_FILES = 5_000;
const REMOTE_IMPORT_ARCHIVE: ArchiveLimits = {
  files: REMOTE_IMPORT_FILES,
  bytes: { limit: 500 * 1024 * 1024, tooLarge: sourceText("error.import.remoteZipTooLarge") },
  expandedTooLarge: sourceText("error.import.remoteExpandedTooLarge", { limit: REMOTE_IMPORT_FILES }),
  invalid: sourceText("error.import.zipInvalid"),
};

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
  initializeMemorySelection(agentId: string): void;
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

interface StagedImport {
  path: string;
  /** The archive `apply` reads must be the one the preview checked. */
  fingerprint: string;
  /** The limits the preview checked, which `apply` checks again. */
  limits: ArchiveLimits;
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
  /** The digest of each skill that an imported agent of this run has, by slug. */
  skills: Map<string, string>;
  /** Each skill of this run that got a new name, by its slug in the export and its digest. */
  renamed: Map<string, ImportSkill>;
}

interface ImportSkill {
  files: Array<readonly [string, Uint8Array]>;
  slug: string;
}

/** The owner of the exports the local user stages. A member's owner is the member id. */
const LOCAL_IMPORT_OWNER = "local";
/** Uploaded exports kept at one time, across all members. */
const UPLOAD_SLOTS = 4;
/** An uploaded export nobody applied is released after this. */
const UPLOAD_TTL_MS = 30 * 60_000;
/** An `agent-import-v2` upload that gets no part for this long is released. */
const PART_UPLOAD_IDLE_MS = 10 * 60_000;

/** An export that a member sends in parts with `agent-import-v2`. */
interface PartUpload {
  owner: string;
  path: string;
  size: number;
  /** The bytes the file has, so the offset of the next part. */
  received: number;
  /** A part is being written. */
  writing: boolean;
  expiry: ReturnType<typeof setTimeout> | null;
}

export class AgentImportService {
  readonly #staged = new Map<string, StagedSlot>();
  readonly #uploads = new Map<string, PartUpload>();
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
    /** `null` when the disk does not say, and then the import does not check. */
    private readonly freeDiskBytes: (path: string) => Effect.Effect<number | null> = (path) =>
      diskSpace(path).pipe(Effect.map((disk) => disk.freeBytes)),
  ) {}

  /** Reads and checks an export. A new stage by the same owner replaces the owner's previous one. */
  readonly stage = Effect.fn("AgentImportService.stage")(function* (
    this: AgentImportService,
    path: string,
    owner = LOCAL_IMPORT_OWNER,
  ) {
    yield* this.#release(owner);
    return yield* this.#stageFile(path, owner, false, IMPORT_ARCHIVE);
  }).bind(this);

  readonly stageUpload = Effect.fn("AgentImportService.stageUpload")(function* (
    this: AgentImportService,
    read: () => Promise<Uint8Array>,
    owner: string,
  ): Effect.fn.Return<AgentImportPreview, ArchiveOperationError> {
    const directory = this.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Agent import uploads are not available."));
    yield* this.#release(owner);
    if (this.#heldUploads() >= UPLOAD_SLOTS)
      return yield* archiveFailure(new Error(sourceText("error.import.hostBusy")));
    this.#busyUploads += 1;
    return yield* Effect.gen({ self: this }, function* () {
      const bytes = yield* archiveCall(() => read());
      yield* this.#prepareUploadDirectory(directory);
      const path = join(directory, `${randomUUID()}.zip`);
      yield* archiveCall(() => writeFile(path, bytes, { flag: "wx", mode: 0o600 })).pipe(
        Effect.uninterruptible,
        // A write that fails part of the way, such as on a full disk, leaves part of the file.
        Effect.tapError(() => archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)),
      );
      return yield* this.#stageUploadedFile(path, owner, REMOTE_IMPORT_ARCHIVE);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#busyUploads -= 1;
        }),
      ),
    );
  }).bind(this);

  /**
   * Starts an `agent-import-v2` upload of `size` bytes and answers its id. A new upload by the same
   * owner releases the owner's earlier upload and export.
   */
  readonly openUpload = Effect.fn("AgentImportService.openUpload")(function* (
    this: AgentImportService,
    size: number,
    owner: string,
  ): Effect.fn.Return<string, ArchiveOperationError> {
    const directory = this.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Agent import uploads are not available."));
    if (size === 0) return yield* archiveFailure(new Error(sourceText("error.import.chooseZip")));
    yield* this.#release(owner);
    if (this.#heldUploads() >= UPLOAD_SLOTS)
      return yield* archiveFailure(new Error(sourceText("error.import.hostBusy")));
    this.#busyUploads += 1;
    return yield* Effect.gen({ self: this }, function* () {
      yield* this.#prepareUploadDirectory(directory);
      const disk = yield* this.freeDiskBytes(directory);
      // From here to the `set`, nothing waits, so a concurrent open sees this upload. Another open by
      // the same owner can have ended during the reads above: it is released, as an earlier upload is.
      const earlier = [...this.#uploads].filter(([, other]) => other.owner === owner);
      // The other uploads still need the bytes they do not have yet.
      const reserved = [...this.#uploads.values()]
        .filter((other) => other.owner !== owner)
        .reduce((total, other) => total + other.size - other.received, 0);
      const free = disk === null ? null : Math.max(0, disk - reserved);
      if (free !== null && size > free)
        return yield* archiveFailure(
          new Error(
            sourceText("error.import.uploadDiskSpace", {
              size: gigabytes(size, Math.ceil),
              free: gigabytes(free, Math.floor),
            }),
          ),
        );
      const uploadId = randomUUID();
      const upload: PartUpload = {
        owner,
        path: join(directory, `${randomUUID()}.zip`),
        size,
        received: 0,
        writing: false,
        expiry: null,
      };
      this.#uploads.set(uploadId, upload);
      yield* Effect.forEach(earlier, ([id, other]) => this.#dropUpload(id, other), { discard: true });
      yield* archiveCall(() => writeFile(upload.path, new Uint8Array(), { flag: "wx", mode: 0o600 })).pipe(
        Effect.tapError(() => this.#dropUpload(uploadId, upload)),
      );
      this.#keepUpload(uploadId, upload);
      return uploadId;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#busyUploads -= 1;
        }),
      ),
    );
  }).bind(this);

  /** Writes the next part of an `agent-import-v2` upload at `offset`, and answers the bytes the upload has. */
  readonly writeUpload = Effect.fn("AgentImportService.writeUpload")(function* (
    this: AgentImportService,
    uploadId: string,
    offset: number,
    read: () => Promise<Uint8Array>,
    owner: string,
  ): Effect.fn.Return<number, ArchiveOperationError> {
    const upload = this.#uploads.get(uploadId);
    // Another member's upload reads as a closed export, so the answer does not show that it exists.
    if (!upload || upload.owner !== owner)
      return yield* archiveFailure(new Error(sourceText("error.import.exportClosed")));
    if (upload.writing || offset !== upload.received)
      return yield* archiveFailure(new Error("The part does not start where the upload ends."));
    upload.writing = true;
    return yield* Effect.gen({ self: this }, function* () {
      this.#keepUpload(uploadId, upload);
      const bytes = yield* archiveCall(() => read());
      if (bytes.length === 0 || upload.received + bytes.length > upload.size)
        return yield* archiveFailure(new Error("The part does not fit the size of the upload."));
      const closed = () => this.#uploads.get(uploadId) !== upload;
      yield* archiveCall(async () => {
        const handle = await open(upload.path, "r+");
        try {
          let written = 0;
          while (written < bytes.length) {
            const { bytesWritten } = await handle.write(bytes, written, bytes.length - written, offset + written);
            if (bytesWritten === 0) throw Object.assign(new Error("The part was not written."), { code: "EIO" });
            written += bytesWritten;
          }
        } finally {
          await handle.close();
        }
      }).pipe(
        Effect.uninterruptible,
        // A new open or the idle expiry can release the upload, and remove its file, during the write.
        Effect.catch((error) => (closed() ? Effect.void : Effect.fail(error))),
      );
      if (closed()) {
        yield* archiveCall(() => rm(upload.path, { force: true })).pipe(Effect.ignore);
        return yield* archiveFailure(new Error(sourceText("error.import.exportClosed")));
      }
      upload.received += bytes.length;
      this.#keepUpload(uploadId, upload);
      return upload.received;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          upload.writing = false;
        }),
      ),
    );
  }).bind(this);

  /** Reads a complete `agent-import-v2` upload and answers its preview, as `stageUpload` does. */
  readonly stageParts = Effect.fn("AgentImportService.stageParts")(function* (
    this: AgentImportService,
    uploadId: string,
    owner: string,
  ): Effect.fn.Return<AgentImportPreview, ArchiveOperationError> {
    const upload = this.#uploads.get(uploadId);
    if (!upload || upload.owner !== owner)
      return yield* archiveFailure(new Error(sourceText("error.import.exportClosed")));
    if (upload.writing || upload.received !== upload.size)
      return yield* archiveFailure(new Error("The upload is not complete."));
    this.#uploads.delete(uploadId);
    if (upload.expiry) clearTimeout(upload.expiry);
    this.#busyUploads += 1;
    // The parts are a complete export, so it has the limits of an export on this computer. The
    // import checks the free disk space of each agent's files.
    return yield* this.#stageUploadedFile(upload.path, owner, IMPORT_ARCHIVE).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#busyUploads -= 1;
        }),
      ),
    );
  }).bind(this);

  /** Uploads that hold a slot: staged, being read, or being sent in parts. */
  #heldUploads(): number {
    const staged = [...this.#staged.values()].filter((slot) => slot.temporary).length;
    return staged + this.#busyUploads + this.#uploads.size;
  }

  /** Restarts the idle timer of a part upload. */
  #keepUpload(uploadId: string, upload: PartUpload) {
    if (upload.expiry) clearTimeout(upload.expiry);
    upload.expiry = setTimeout(() => {
      void runCauseEffect(this.#dropUpload(uploadId, upload));
    }, PART_UPLOAD_IDLE_MS);
    upload.expiry.unref();
  }

  readonly #dropUpload = Effect.fn("AgentImportService.dropUpload")(function* (
    this: AgentImportService,
    uploadId: string,
    upload: PartUpload,
  ) {
    if (this.#uploads.get(uploadId) !== upload) return;
    this.#uploads.delete(uploadId);
    if (upload.expiry) clearTimeout(upload.expiry);
    yield* archiveCall(() => rm(upload.path, { force: true })).pipe(Effect.ignore);
  });

  /** Stages an uploaded file, and removes it when it does not stage. */
  readonly #stageUploadedFile = Effect.fn("AgentImportService.stageUploadedFile")(function* (
    this: AgentImportService,
    path: string,
    owner: string,
    limits: ArchiveLimits,
  ): Effect.fn.Return<AgentImportPreview, ArchiveOperationError> {
    let retained = false;
    return yield* Effect.acquireUseRelease(
      Effect.succeed(path),
      () =>
        Effect.gen({ self: this }, function* () {
          const preview = yield* this.#stageFile(path, owner, true, limits);
          retained = true;
          return preview;
        }),
      () => (retained ? Effect.void : archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)),
    );
  });

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
    limits: ArchiveLimits,
  ): Effect.fn.Return<AgentImportPreview, ArchiveOperationError> {
    const archive = yield* readArchiveEffect(path, limits);
    const entries = archive.entries;
    const wrapper = wrapperFolder([...entries.keys()]);
    const inner = new Map([...entries].map(([name, entry]) => [name.slice(wrapper.length), entry]));
    const manifestName = `${wrapper}${AGENT_IMPORT_MANIFEST}`;
    if (!entries.has(manifestName))
      return yield* archiveFailure(
        new Error(sourceText("error.import.manifestMissing", { manifest: AGENT_IMPORT_MANIFEST })),
      );
    const manifestBytes =
      (yield* readEntriesEffect(archive, [manifestName], MANIFEST_MAX_BYTES))[manifestName] ?? new Uint8Array();
    const { manifest, warnings } = yield* archiveSync(() =>
      decodeImportManifest(manifestBytes, this.agents.memoryLimit()),
    );
    if (archive.skipped) warnings.push(sourceText("error.import.foldersSkipped", { number: archive.skipped }));

    const avatarPaths = new Set(manifest.agents.flatMap((agent) => (agent.avatar ? [wrapper + agent.avatar] : [])));
    const avatarBytes = yield* readEntriesEffect(archive, avatarPaths, AVATAR_IMAGE_LIMITS.sourceBytes);
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
      value: {
        path,
        fingerprint: archive.fingerprint,
        limits,
        agents: manifest.agents,
        channels: manifest.channels,
        wrapper,
        avatars,
      },
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
        skills: new Map(),
        renamed: new Map(),
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
    for (const [uploadId, upload] of this.#uploads)
      if (upload.owner === owner) yield* this.#dropUpload(uploadId, upload);
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

    // The file can change after `stage`, so only the same central directory is accepted. Each entry
    // is checked against its size and CRC there when it is read.
    const archive = yield* readArchiveEffect(staged.path, staged.limits);
    if (archive.fingerprint !== staged.fingerprint)
      return yield* archiveFailure(new Error(sourceText("error.import.exportChanged")));
    const imported: AgentSummary[] = [];
    const skipped: AgentImportSkipped[] = [];
    const warnings: string[] = [];
    const agentIds = new Map<string, string>();
    for (const agent of selected) {
      const importedAgent = yield* Effect.result(this.#importAgent(archive, staged, agent, context, warnings));
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
    archive: ArchiveFile,
    staged: StagedImport,
    source: ImportAgent,
    context: ImportContext,
    warnings: string[],
  ): Effect.fn.Return<AgentSummary, ArchiveOperationError> {
    // The manifest keeps each path of an agent inside `agents/<key>/`, so only those entries are searched.
    const prefix = `${staged.wrapper}agents/${source.key}/`;
    const agentEntries = [...archive.entries.values()].filter((entry) => entry.name.startsWith(prefix));
    /** The entries under a folder of the export, by their names in that folder. */
    const under = (path: string) => {
      const folder = `${staged.wrapper}${path}/`;
      return agentEntries
        .filter((entry) => entry.name.startsWith(folder))
        .map((entry) => [entry.name.slice(folder.length), entry] as const);
    };
    // Every skill is checked before the agent exists, so a bad one publishes nothing.
    const skills: ImportSkill[] = [];
    const planned = new Map(context.skills);
    const renames = new Map(context.renamed);
    for (const path of source.skills) {
      const skill = yield* readSkillEffect(archive, under(path));
      const digest = skillDigest(skill.files);
      // The same skill as one that got a new name keeps that name.
      const key = `${skill.slug}\0${digest}`;
      const renamedBefore = renames.get(key);
      if (renamedBefore) {
        skills.push(renamedBefore);
        continue;
      }
      const earlier = planned.get(skill.slug);
      if (earlier === undefined || earlier === digest) {
        planned.set(skill.slug, digest);
        skills.push(skill);
        continue;
      }
      // A different skill of this import has a name with the same slug. This one gets a new name,
      // so that it does not replace that skill.
      const library = yield* this.skills
        .library()
        .list()
        .pipe(Effect.mapError((error) => archiveFailure(error.cause)));
      const names = new Map(library.map((candidate) => [candidate.slug, candidate.name]));
      const renamed = yield* archiveSync(() => renameSkill(skill.files, planned, names));
      warnings.push(
        sourceText("error.import.skillRenamed", { name: source.name, skill: renamed.from, renamed: renamed.name }),
      );
      planned.set(renamed.slug, digest);
      renames.set(key, renamed);
      skills.push(renamed);
    }
    const files = source.files ? under(source.files) : [];

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
            if (files.length) {
              // Each file takes whole disk blocks, so a small file counts as one 4 KB block.
              const needed = files.reduce((total, [, entry]) => total + Math.ceil(entry.size / 4096) * 4096, 0);
              const free = yield* this.freeDiskBytes(agent.workspacePath);
              if (free !== null && needed > free)
                return yield* archiveFailure(
                  new Error(
                    sourceText("error.import.diskSpace", {
                      name: source.name,
                      size: gigabytes(needed, Math.ceil),
                      free: gigabytes(free, Math.floor),
                    }),
                  ),
                );
              yield* writeImportedFilesEffect(
                join(agent.workspacePath, IMPORTED_FILES),
                archive,
                files,
                source.name,
                warnings,
              );
            }
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
            // The limit can be lower now than when the archive was read.
            const memoryLimit = this.agents.memoryLimit();
            if (source.memories.length > memoryLimit)
              warnings.push(sourceText("error.import.memoryLimit", { name: source.name, limit: memoryLimit }));
            for (const text of source.memories.slice(0, memoryLimit))
              this.agents.createMemory({ agentId: agent.id, text });
            this.agents.initializeMemorySelection(agent.id);
            const avatar = staged.avatars.get(source.key);
            if (avatar)
              agent = yield* this.agents
                .setAvatar(agent.id, avatar)
                .pipe(Effect.mapError((error) => archiveFailure(error.cause)))
                .pipe(Effect.uninterruptible);
            for (const [slug, digest] of planned) context.skills.set(slug, digest);
            for (const [key, skill] of renames) context.renamed.set(key, skill);
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

/** The same digest for the same files, in any order. */
function skillDigest(files: ReadonlyArray<readonly [string, Uint8Array]>): string {
  const hash = createHash("sha256");
  for (const [name, data] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    hash.update(`${name}\0${data.byteLength}\0`).update(data);
  return hash.digest("hex");
}

/**
 * The skill with ` 2`, ` 3`, ... after its frontmatter name, at the first number whose slug this run
 * does not use. A library skill can have that slug only with the same name: an earlier import of
 * the same export saved it, so this import revises it as it revises a skill that keeps its name.
 */
function renameSkill(
  files: ReadonlyArray<readonly [string, Uint8Array]>,
  planned: ReadonlyMap<string, string>,
  library: ReadonlyMap<string, string>,
) {
  const index = files.findIndex(([name]) => name === "SKILL.md");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(files[index]?.[1]);
  const match = text.match(SKILL_FRONTMATTER);
  const frontmatter = parseDocument(match?.[1] ?? "");
  const from = String(frontmatter.get("name")).trim();
  // A slug keeps 64 characters, so a long name is cut to keep the number in its slug.
  const base = from.slice(0, 56).trimEnd();
  for (let number = 2; number <= planned.size + library.size + 2; number++) {
    const name = `${base} ${number}`;
    frontmatter.set("name", name);
    const head = `---\n${frontmatter.toString({ lineWidth: 0 })}---\n`;
    const skillFile = new TextEncoder().encode(head + text.slice(match?.[0].length ?? 0));
    // The slug comes from SKILL.md alone, so the other files are not zipped for each number.
    const { slug } = inspectArchive(zipSync({ "SKILL.md": skillFile }));
    if (!planned.has(slug) && (library.get(slug) ?? name) === name)
      return {
        files: files.map((file, at) => (at === index ? (["SKILL.md", skillFile] as const) : file)),
        slug,
        from,
        name,
      };
  }
  throw new Error(sourceText("error.skill.localNameTaken"));
}

/** A zip made by compressing a folder puts everything in that folder. */
function wrapperFolder(names: string[]): string {
  if (names.includes(AGENT_IMPORT_MANIFEST)) return "";
  const roots = new Set(names.map((name) => name.split("/")[0]));
  const [root] = roots;
  return roots.size === 1 && root && names.every((name) => name.includes("/")) ? `${root}/` : "";
}

function filesUnder(entries: Map<string, ArchiveEntry>, folder: string): Array<[string, ArchiveEntry]> {
  return [...entries].filter(([name]) => name.startsWith(`${folder}/`));
}

/** GB with one decimal place. The needed space rounds up and the free space down, so they never look equal. */
function gigabytes(bytes: number, round: (value: number) => number): string {
  return (round((bytes / 1024 ** 3) * 10) / 10).toFixed(1);
}

function bounded(warnings: string[]): string[] {
  return warnings.slice(0, AGENT_IMPORT_LIMITS.warnings).map((text) => text.slice(0, AGENT_IMPORT_LIMITS.message));
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : "The import failed.";
  return text.slice(0, AGENT_IMPORT_LIMITS.message);
}
