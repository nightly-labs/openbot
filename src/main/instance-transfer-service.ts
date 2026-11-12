// Instance transfer: the agents and app settings of this computer in one `.zip` file, and the import
// of such a file on another computer. See `docs/architecture/instance-transfer.md`.
//
// No secret goes into the file. MCP variable and header values are emptied, custom providers lose
// their keys, custom agents keep only the names of their variables, and sign-ins are recorded as
// provider ids only. Imported agents get this computer's approval rules: the file carries no access,
// Computer Use, automation or auto-approve setting.
//
// Each agent is created through the same services the user reaches by hand. When one step fails,
// that agent is deleted and reported, and the other agents continue. Settings add what is missing
// here and never replace an MCP server, provider or custom agent that this computer has.

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { AVATAR_IMAGE_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_IMPORT_LIMITS,
  type AgentImportPreviewAgent,
  type AgentImportSkipped,
  type AgentMemory,
  type AgentMemorySelectionState,
  type AgentModelOption,
  type AgentSummary,
  type ApplyInstanceTransferInput,
  AVATAR_SEED_PATTERN,
  type AvatarImageInput,
  type Channel,
  type ChannelBrowser,
  type ChannelCommand,
  type ChannelMemory,
  type ChannelRoutine,
  type ConnectRoutineFlowInput,
  type CreateAgentInput,
  type CreateChannelMemoryInput,
  type CreateChannelRoutineInput,
  type CreateRoutineInput,
  type CustomAgentSummary,
  type CustomProviderSummary,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  type ExportInstanceInput,
  INSTANCE_TRANSFER_LIMITS,
  type InstanceExportResult,
  type InstanceTransferAgent,
  type InstanceTransferPreview,
  type InstanceTransferResult,
  type InstanceTransferSummary,
  isAgentImportKey,
  isAvatarColor,
  isChannelBrowser,
  isChannelDraft,
  isChannelIcon,
  isCustomProviderContextWindow,
  isCustomProviderHarness,
  isCustomProviderInputs,
  isCustomProviderMaxOutput,
  isCustomProviderReasoningEfforts,
  type McpServerConfig,
  ROUTINE_LIMIT_POLICIES,
  ROUTINE_MISSED_POLICIES,
  ROUTINE_RUN_PLACES,
  type Routine,
  type RoutineFlowLink,
  type RoutineFlowPosition,
  type SaveCustomProviderInput,
  type SaveRoutineFlowPositionInput,
  type SetAgentMemoryInclusionInput,
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  type EventRoutine,
  type EventRoutineOwner,
  isEventRoutineTriggerInput,
  type SaveEventRoutineInput,
} from "@openbot/contracts/ipc-events";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { INSTANCE_TRANSFER_REMOTE_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit, Result } from "effect";
import { Zip, ZipPassThrough } from "fflate";
import { isMissingFileError } from "../backend/file-errors";
import { isPathInside } from "../backend/path-containment";
import {
  type ArchiveFile,
  type ArchiveLimits,
  avatarImage,
  extractEntryEffect,
  isUnsafeEntry,
  MANIFEST_MAX_BYTES,
  readArchiveEffect,
  readEntriesEffect,
  readSkillEffect,
  withArchive,
  writeImportedFilesEffect,
  writeTreeEffect,
} from "./agent-archive";
import type { AgentImportSkills, ChannelActor } from "./agent-import-service";
import { validTimezone } from "./agent-marketplace-service";
import { type ArchiveOperationError, archiveCall, archiveFailure, archiveSync } from "./archive-effects";
import { InstanceTransferChunks } from "./instance-transfer-chunks";
import {
  exportChannelMessages,
  exportHistory,
  importChannelMessages,
  importHistory,
  type TransferChannelHistory,
  type TransferHistoryAgents,
} from "./instance-transfer-history";
import {
  agentPrefix,
  channelPrefix,
  decodeTransferManifest,
  INSTANCE_TRANSFER_FORMAT,
  INSTANCE_TRANSFER_MANIFEST,
  INSTANCE_TRANSFER_VERSION,
  SHARED_FOLDER,
  TRANSFER_CHANNELS,
  type TransferAgent,
  type TransferChannel,
  type TransferManifest,
  type TransferManifestFile,
  type TransferSettings,
} from "./instance-transfer-manifest";
import {
  applyPreferences,
  hiddenAgentWasStopped,
  readPreferences,
  type TransferPreferenceAgents,
  type TransferPreferencePort,
} from "./instance-transfer-preferences";
import { exportWorkflows, importWorkflows, type TransferWorkflowPort } from "./instance-transfer-workflows";
import { MANAGED_SKILL_FOLDERS, OWNERSHIP_MARKER } from "./managed-skill-service";
import { readPackFolders } from "./skill-marketplace-service";
import { isUnsafeArchivePath } from "./skill-package";

const ARCHIVE: ArchiveLimits = {
  files: INSTANCE_TRANSFER_LIMITS.files,
  bytes: { limit: INSTANCE_TRANSFER_LIMITS.archiveBytes, tooLarge: sourceText("error.import.transferTooLarge") },
  expandedTooLarge: sourceText("error.import.transferTooLarge"),
  invalid: sourceText("error.import.transferNotFile"),
};
/**
 * `Data/` in `~/OpenBot/Shared` holds the shared tables database. It is open while the app runs, and
 * its owner records name agent ids of this computer, so a transfer never copies it.
 */
const SHARED_DATA = "data";
/**
 * `Transfers/` in `~/OpenBot/Shared` holds the files of chat messages. Only a message names such a
 * file, so the files travel with the chat history, not with the Shared folder.
 */
const SHARED_TRANSFERS = "transfers";
/** A file sent to or from a member of a joined client: one WebRTC file transfer. */
const REMOTE_ARCHIVE: ArchiveLimits = {
  files: INSTANCE_TRANSFER_LIMITS.files,
  bytes: { limit: INSTANCE_TRANSFER_REMOTE_BYTES, tooLarge: sourceText("error.import.transferRemoteTooLarge") },
  expandedTooLarge: sourceText("error.import.transferRemoteTooLarge"),
  invalid: sourceText("error.import.transferNotFile"),
};
/** The owner of the files the local user reads. A member's owner is the member id. */
const LOCAL_OWNER = "local";
/** A file that a member sent and nobody applied is removed after this. */
const UPLOAD_TTL_MS = 30 * 60_000;
/** Skill folders are copied here, published to the local library, and removed again. */
const SKILL_STAGING = ".openbot/import-skills";
/** Workspace folders an export leaves out: OpenBot's own state and the installed skills, which travel as skills. */
const WORKSPACE_SKIPPED = [".openbot", ...MANAGED_SKILL_FOLDERS];
const AVATAR_EXTENSIONS: Record<AvatarImageInput["mimeType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The agent operations a transfer uses, as `AgentService` offers them. */
interface InstanceTransferAgents extends TransferPreferenceAgents, TransferHistoryAgents {
  listAgents(): AgentSummary[];
  listRoutines(agentId: string): Routine[];
  listMemories(agentId: string): AgentMemory[];
  getMemorySelection(agentId: string): Pick<AgentMemorySelectionState, "selections">;
  setMemoryInclusion(input: SetAgentMemoryInclusionInput): unknown;
  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"] } | null;
  listModels(): Array<Pick<AgentModelOption, "provider" | "id">>;
  createAgentProfile(
    input: Omit<CreateAgentInput, "initialMessage"> & { title?: string },
  ): Effect.Effect<AgentSummary, unknown>;
  updateAgent(input: UpdateAgentInput): Effect.Effect<AgentSummary, unknown>;
  createRoutine(input: CreateRoutineInput, options?: { recordConversationEvent?: boolean }): Pick<Routine, "id">;
  createMemory(input: { agentId: string; text: string }): Pick<AgentMemory, "id">;
  memoryLimit(): number;
  initializeMemorySelection(agentId: string): void;
  setAvatar(agentId: string, image: AvatarImageInput | null): Effect.Effect<AgentSummary, unknown>;
  deleteAgent(agentId: string): Effect.Effect<void, unknown>;
  channels: TransferChannelHistory & {
    store: {
      ids(): string[];
      get(channelId: string): Channel;
    };
    images: { resolve(channel: Channel): { path: string; mimeType: AvatarImageInput["mimeType"] } | null };
    command(command: ChannelCommand, actor: ChannelActor): Effect.Effect<Channel, unknown>;
    setImage(channelId: string, image: AvatarImageInput | null): Effect.Effect<unknown, unknown>;
  };
  listChannelMemories(channelId: string): ChannelMemory[];
  listChannelRoutines(channelId: string): ChannelRoutine[];
  createChannelMemory(input: CreateChannelMemoryInput): unknown;
  createChannelRoutine(input: CreateChannelRoutineInput): Pick<ChannelRoutine, "id">;
  deleteChannel(channelId: string): Effect.Effect<void, unknown>;
}

/** The server settings an export reads and an import writes. Main wires each to its owner. */
interface InstanceTransferSettings {
  mcpServers(): McpServerConfig[];
  saveMcpServer(config: McpServerConfig): Effect.Effect<unknown, unknown>;
  customProviders(): CustomProviderSummary[];
  saveCustomProvider(input: SaveCustomProviderInput): Effect.Effect<unknown, unknown>;
  customAgents(): Effect.Effect<CustomAgentSummary[], unknown>;
  /** Read only: an agent keeps its model only when its provider is on. */
  providersOff(): readonly AgentProviderId[];
  sidebar(): SidebarLayoutSnapshot;
  mutateSidebar(action: SidebarLayoutAction): Effect.Effect<SidebarLayoutSnapshot, unknown>;
  routineFlowLinks(agentId: string): Effect.Effect<RoutineFlowLink[], unknown>;
  connectRoutineFlow(input: ConnectRoutineFlowInput): Effect.Effect<unknown, unknown>;
  /** Providers that are signed in and ready on this computer. */
  signedInProviders(): AgentProviderId[];
  /** Absent where the server runs no workflows. */
  workflows?: TransferWorkflowPort;
  routineFlowPositions?(agentId: string): Effect.Effect<RoutineFlowPosition[], unknown>;
  saveRoutineFlowPosition?(input: SaveRoutineFlowPositionInput): Effect.Effect<unknown, unknown>;
}

/** A routine that a webhook starts, as the file keeps it. Its address and secret stay behind. */
interface TransferWebhookRoutine {
  key: string;
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  eventType: string | null;
  filters: unknown[];
  limitPolicy?: string;
  missedPolicy?: string;
  runIn?: string;
}

export interface InstanceTransferOptions {
  agents: InstanceTransferAgents;
  skills: AgentImportSkills;
  settings: InstanceTransferSettings;
  /** `~/OpenBot/Shared`. */
  sharedRoot: string;
  /** Who creates an imported channel when the local user imports. */
  channelActor: () => ChannelActor;
  /** The local owner's choices for agents. A member's import does not change them. */
  preferences?: TransferPreferencePort;
  /** Routines that a webhook starts. Absent where the server has no events service. */
  webhookRoutines?: {
    list(owner: EventRoutineOwner): Effect.Effect<EventRoutine[], unknown>;
    save(input: SaveEventRoutineInput): Effect.Effect<{ routine: Pick<EventRoutine, "id"> }, unknown>;
  };
  appVersion: string;
  /** Where a file sent by a member of a joined client, or made for one, waits. */
  uploadDirectory?: string;
  timezone?: () => string;
  now?: () => Date;
}

interface FileEntry {
  /** The path inside the archive folder, with `/`. */
  name: string;
  path: string;
  size: number;
  executable: boolean;
}

interface StagedTransfer {
  token: string;
  /** Only the owner can apply or discard the token: the local user or one member. */
  owner: string;
  /** A file the service wrote for a member, removed when the token ends. */
  temporary: boolean;
  path: string;
  /** The archive `apply` reads must be the one the preview checked. */
  fingerprint: string;
  manifest: TransferManifest;
  avatars: Map<string, AvatarImageInput>;
}

export class InstanceTransferService {
  readonly #staged = new Map<string, StagedTransfer>();
  readonly #timezone: () => string;
  readonly #now: () => Date;
  #uploadDirectoryReady: Deferred.Deferred<void, ArchiveOperationError> | null = null;
  /** `instance-transfer-chunks-v1`: a file for a member of a joined client, in parts, up to the local limits. */
  readonly chunks: InstanceTransferChunks;

  constructor(private readonly options: InstanceTransferOptions) {
    this.#timezone = options.timezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    this.#now = options.now ?? (() => new Date());
    this.chunks = new InstanceTransferChunks({
      directory: () => {
        const directory = options.uploadDirectory;
        if (!directory) return Effect.fail(archiveFailure(new Error("Instance transfer uploads are not available.")));
        return this.#prepareUploadDirectory(directory).pipe(Effect.as(directory));
      },
      stage: (path, owner) => this.#stageFile(path, owner, true, ARCHIVE),
      exportTo: (path, input, exporter) => this.exportTo(path, input, ARCHIVE, exporter),
    });
  }

  /** What each agent would carry: the export screen shows it before anything is written. */
  readonly summary = Effect.fn("InstanceTransfer.summary")(function* (
    this: InstanceTransferService,
  ): Effect.fn.Return<InstanceTransferSummary, ArchiveOperationError> {
    const agents: InstanceTransferAgent[] = [];
    for (const agent of this.options.agents.listAgents()) {
      // The counts are a preview: a folder that cannot be read stops the export, not this screen,
      // so an export without files stays possible.
      const files = yield* workspaceFiles(agent.workspacePath).pipe(Effect.orElseSucceed(() => []));
      const skills = yield* skillFolders(agent.workspacePath).pipe(Effect.orElseSucceed(() => []));
      agents.push({
        id: agent.id,
        name: agent.name,
        title: agent.title,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        avatarUrl: agent.avatarUrl,
        skillCount: skills.length,
        routineCount: this.options.agents.listRoutines(agent.id).length,
        memoryCount: this.options.agents.listMemories(agent.id).length,
        fileCount: files.length,
        fileBytes: files.reduce((total, file) => total + file.size, 0),
      });
    }
    return { agents };
  }).bind(this);

  /** Writes the export to `path`. The file appears only when it is complete. */
  readonly exportTo = Effect.fn("InstanceTransfer.export")(function* (
    this: InstanceTransferService,
    path: string,
    input: ExportInstanceInput,
    limits: ArchiveLimits = ARCHIVE,
    /** The person whose channel messages the import gives to the person who imports. */
    exporter?: string,
  ): Effect.fn.Return<InstanceExportResult, ArchiveOperationError> {
    return yield* (yield* this.prepareExport(input, limits, exporter)).write(path);
  }).bind(this);

  /**
   * Reads what the export carries and checks the file limits, before the user chooses where to save
   * it. `write` writes that export.
   */
  readonly prepareExport = Effect.fn("InstanceTransfer.prepareExport")(function* (
    this: InstanceTransferService,
    input: ExportInstanceInput,
    limits: ArchiveLimits = ARCHIVE,
    exporter?: string,
  ): Effect.fn.Return<PreparedExport, ArchiveOperationError> {
    const all = this.options.agents.listAgents();
    const selected = input.agentIds.map((id) => all.find((agent) => agent.id === id));
    if (selected.some((agent) => !agent))
      return yield* archiveFailure(new Error(sourceText("error.import.agentNotInExport")));
    const agents = selected.filter((agent): agent is AgentSummary => agent !== undefined);

    const entries: ZipEntry[] = [];
    const warnings: string[] = [];
    const keys = new Map<string, string>();
    const manifestAgents: TransferAgent[] = [];
    let bytes = 0;
    // Every key first: a message of one agent can name another agent of the file.
    for (const [index, agent] of agents.entries())
      keys.set(agent.id, isAgentImportKey(agent.id) ? agent.id : `agent-${index + 1}`);
    for (const agent of agents) {
      const key = keys.get(agent.id) ?? agent.id;
      const prefix = agentPrefix(key);

      let avatar: string | null = null;
      const resolved = this.options.agents.resolveAvatar(agent.id);
      if (resolved) {
        avatar = `${prefix}avatar.${AVATAR_EXTENSIONS[resolved.mimeType]}`;
        const avatarPath = resolved.path;
        entries.push({ name: avatar, read: () => readFile(avatarPath) });
      }

      const skills: string[] = [];
      // An import refuses an agent with more skills than the limit, so the export keeps the first ones.
      const folders = yield* skillFolders(agent.workspacePath);
      if (folders.length > INPUT_LIMITS.agentSkills)
        warnings.push(
          sourceText("error.import.transferSkillLimit", {
            name: agent.name,
            limit: INPUT_LIMITS.agentSkills,
            total: folders.length,
          }),
        );
      for (const skill of folders.slice(0, INPUT_LIMITS.agentSkills)) {
        const folder = `${prefix}skills/${skill.slug}`;
        skills.push(folder);
        for (const file of skill.files) {
          bytes += file.size;
          entries.push({ name: `${folder}/${file.name}`, read: () => readFile(file.path) });
        }
      }

      let files: string | null = null;
      if (input.includeFiles) {
        const workspace = yield* workspaceFiles(agent.workspacePath);
        if (workspace.length > 0) {
          files = `${prefix}workspace`;
          for (const file of workspace) {
            bytes += file.size;
            entries.push({
              name: `${files}/${file.name}`,
              read: () => readFile(file.path),
              executable: file.executable,
            });
          }
        }
      }

      const routines = this.options.agents.listRoutines(agent.id).map(transferRoutine);
      const oneTimeRoutines = routines.filter((routine) => routine.schedule.kind === "once");

      const selections = new Map(
        this.options.agents
          .getMemorySelection(agent.id)
          .selections.filter((selection) => selection.userControlled)
          .map((selection) => [selection.memoryId, selection.inclusion] as const),
      );
      const preferences = this.options.preferences
        ? yield* readPreferences(agent, this.options.preferences)
        : undefined;
      const webhookRoutines = yield* this.#readWebhookRoutines({ kind: "agent", id: agent.id });
      let history: string | null = null;
      if (input.includeHistory) {
        const exported = yield* exportHistory(this.options.agents, agent.id, prefix, keys, entries);
        history = exported.index;
        bytes += exported.bytes;
      }
      manifestAgents.push({
        key,
        name: agent.name,
        title: agent.title,
        description: agent.description,
        avatarSeed: agent.avatarSeed,
        avatarHue: agent.avatarHue,
        ...(agent.avatarColor ? { avatarColor: agent.avatarColor } : {}),
        ...(agent.chatColor ? { chatColor: agent.chatColor } : {}),
        avatar,
        provider: agent.provider,
        model: agent.model,
        reasoningEffort: agent.reasoningEffort,
        notifications: agent.notifications,
        ...(agent.busyMessageMode ? { busyMessageMode: agent.busyMessageMode } : {}),
        ...(agent.taskLimit === undefined ? {} : { taskLimit: agent.taskLimit }),
        skills,
        files,
        routines: routines.filter((routine) => routine.schedule.kind !== "once"),
        ...(oneTimeRoutines.length > 0 ? { oneTimeRoutines } : {}),
        memories: this.options.agents.listMemories(agent.id).map((memory) => {
          const inclusion = selections.get(memory.id);
          return { text: memory.text, ...(inclusion ? { inclusion } : {}) };
        }),
        ...(preferences ? { preferences } : {}),
        ...(history ? { history } : {}),
        ...(webhookRoutines.length > 0 ? { webhookRoutines } : {}),
      });
    }

    const channels: TransferChannel[] = [];
    const channelKeys = new Map<string, string>();
    const channelPort = this.options.agents.channels;
    const channelMessages = (port: TransferChannelHistory, channelId: string, prefix: string) => {
      const exported = exportChannelMessages(port, channelId, prefix, keys, entries);
      bytes += exported.bytes;
      return exported.parts.length > 0 ? { messages: exported.parts } : {};
    };
    for (const channelId of channelPort.store.ids()) {
      const channel = channelPort.store.get(channelId);
      const members = channel.members.flatMap((member) => keys.get(member.agentId) ?? []);
      if (members.length === 0) continue;
      if (channels.length === TRANSFER_CHANNELS) {
        warnings.push(sourceText("error.import.transferChannelLimit", { limit: TRANSFER_CHANNELS }));
        break;
      }
      if (channel.instructions.length > INPUT_LIMITS.agentDescription)
        warnings.push(
          sourceText("error.import.transferChannelInstructionsCut", {
            name: channel.name,
            limit: INPUT_LIMITS.agentDescription,
          }),
        );
      const key = isAgentImportKey(channel.id) ? channel.id : `channel-${channels.length + 1}`;
      channelKeys.set(channel.id, key);
      let image: string | null = null;
      const resolved = channelPort.images.resolve(channel);
      if (resolved) {
        image = `${channelPrefix(key)}image.${AVATAR_EXTENSIONS[resolved.mimeType]}`;
        const imagePath = resolved.path;
        entries.push({ name: image, read: () => readFile(imagePath) });
      }
      channels.push({
        key,
        name: channel.name,
        title: channel.title,
        // A channel can keep longer instructions from before the limit, but a new channel cannot.
        instructions: channel.instructions.slice(0, INPUT_LIMITS.agentDescription),
        members,
        lead: channel.leadAgentId ? (keys.get(channel.leadAgentId) ?? null) : null,
        ...(channel.isolated === undefined ? {} : { isolated: channel.isolated }),
        ...(channel.browser ? { browser: transferBrowser(channel.browser, (agentId) => keys.get(agentId)) } : {}),
        ...(channel.icon ? { icon: channel.icon } : {}),
        image,
        archived: channel.archived,
        memories: this.options.agents.listChannelMemories(channel.id).map((memory) => memory.text),
        routines: this.options.agents.listChannelRoutines(channel.id).map(transferRoutine),
        ...(yield* this.#readWebhookRoutines({ kind: "channel", id: channel.id }).pipe(
          Effect.map((webhookRoutines) => (webhookRoutines.length > 0 ? { webhookRoutines } : {})),
        )),
        ...(input.includeHistory ? channelMessages(channelPort, channel.id, channelPrefix(key)) : {}),
      });
    }

    let shared: typeof SHARED_FOLDER | null = null;
    if (input.includeFiles) {
      const sharedFiles = yield* walk(this.options.sharedRoot, isSharedData);
      if (sharedFiles.length > 0) shared = SHARED_FOLDER;
      for (const file of sharedFiles) {
        bytes += file.size;
        entries.push({
          name: `${SHARED_FOLDER}/${file.name}`,
          read: () => readFile(file.path),
          executable: file.executable,
        });
      }
    }
    // A transfer file has the same text for both limits.
    if (entries.length + 1 > limits.files || bytes > (limits.bytes?.limit ?? Number.POSITIVE_INFINITY))
      return yield* archiveFailure(new Error(limits.expandedTooLarge));

    const manifest: TransferManifestFile = {
      format: INSTANCE_TRANSFER_FORMAT,
      version: INSTANCE_TRANSFER_VERSION,
      source: { appVersion: this.options.appVersion, exportedAt: this.#now().toISOString() },
      agents: manifestAgents,
      settings: input.includeSettings ? yield* this.#readSettings(keys, channelKeys, manifestAgents) : null,
      shared,
      signedIn: this.options.settings.signedInProviders(),
      ...(channels.length > 0 ? { channels, exporter: exporter ?? this.options.channelActor().id } : {}),
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    entries.unshift({ name: INSTANCE_TRANSFER_MANIFEST, read: () => Promise.resolve(manifestBytes) });
    return {
      write: (path: string) =>
        writeZipEffect(path, entries).pipe(
          Effect.map((gone) => ({
            saved: true,
            fileName: basename(path),
            warnings:
              gone > 0 ? [...warnings, sourceText("error.import.transferFilesGone", { number: gone })] : warnings,
          })),
        ),
    };
  }).bind(this);

  /**
   * Writes an export for a member of a joined client to a new file in the upload folder. The caller
   * sends it and removes it. The file stays under what one WebRTC file transfer can carry.
   */
  readonly exportForMember = Effect.fn("InstanceTransfer.exportForMember")(function* (
    this: InstanceTransferService,
    input: ExportInstanceInput,
    memberId: string,
  ): Effect.fn.Return<string, ArchiveOperationError> {
    const directory = this.options.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Instance transfer uploads are not available."));
    yield* this.#prepareUploadDirectory(directory);
    const path = join(directory, `${randomUUID()}.zip`);
    yield* this.exportTo(path, input, REMOTE_ARCHIVE, memberId).pipe(
      Effect.tapError(() => archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)),
    );
    return path;
  }).bind(this);

  readonly #readSettings = Effect.fn("InstanceTransfer.readSettings")(function* (
    this: InstanceTransferService,
    keys: ReadonlyMap<string, string>,
    channelKeys: ReadonlyMap<string, string>,
    agents: readonly TransferAgent[],
  ): Effect.fn.Return<TransferSettings, ArchiveOperationError> {
    const settings = this.options.settings;
    const layout = settings.sidebar();
    const routineKeys = new Set(
      agents.flatMap((agent) => [
        ...transferRoutines(agent).map((routine) => routine.key),
        ...(agent.webhookRoutines ?? []).flatMap((routine) =>
          isDynamicRecord(routine) && typeof routine.key === "string" ? [routine.key] : [],
        ),
      ]),
    );
    const links = new Map<string, RoutineFlowLink>();
    for (const agentId of keys.keys())
      for (const link of yield* settings.routineFlowLinks(agentId).pipe(Effect.mapError(failure)))
        links.set(link.id, link);
    const redact = createRedaction();
    const positions: NonNullable<TransferSettings["routineFlowPositions"]>[number][] = [];
    if (settings.routineFlowPositions)
      for (const [agentId, agentKey] of keys)
        for (const position of yield* settings
          .routineFlowPositions(agentId)
          .pipe(Effect.orElseSucceed((): RoutineFlowPosition[] => []))) {
          const nodeKey = filePositionKey(position.nodeKey, keys, routineKeys);
          if (nodeKey) positions.push({ agentKey, nodeKey, x: position.x, y: position.y });
        }
    const workflows = settings.workflows
      ? exportWorkflows(yield* settings.workflows.workflows().pipe(Effect.mapError(failure)), keys, channelKeys)
      : [];
    const order = [
      ...layout.agentOrder,
      ...Object.keys(layout.agentAssignments).filter((id) => !layout.agentOrder.includes(id)),
    ];
    return {
      mcpServers: settings.mcpServers().map((server) => ({
        ...server,
        id: "",
        args: redact.args(server.name, server.args),
        url: redact.origin(server.name, server.url),
        env: server.env.map(({ key }) => ({ key, value: "" })),
        headers: server.headers.map(({ key }) => ({ key, value: "" })),
      })),
      customProviders: settings.customProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: redact.url(provider.name, provider.baseUrl),
        models: provider.models,
        needsApiKey: provider.hasApiKey,
        ...(provider.harness && provider.harness !== DEFAULT_CUSTOM_PROVIDER_HARNESS
          ? { harness: provider.harness }
          : {}),
      })),
      customAgents: (yield* settings.customAgents().pipe(Effect.mapError(failure))).map((agent) => ({
        id: agent.id,
        name: agent.name,
        command: agent.command,
        args: redact.args(agent.name, agent.args),
        envNames: agent.envNames,
      })),
      sidebarSections: layout.sections.map((section) => ({
        name: section.name,
        agentKeys: order.flatMap((agentId) => {
          const key = keys.get(agentId);
          return key && layout.agentAssignments[agentId] === section.id ? [key] : [];
        }),
      })),
      routineFlows: [...links.values()].flatMap((link) => {
        const fromAgentKey = keys.get(link.fromAgentId);
        const toAgentKey = keys.get(link.toAgentId);
        return fromAgentKey && toAgentKey && routineKeys.has(link.routineId)
          ? [{ routineKey: link.routineId, fromAgentKey, toAgentKey, instruction: link.instruction }]
          : [];
      }),
      cleared: redact.cleared(),
      ...(workflows.length > 0 ? { workflows } : {}),
      ...(positions.length > 0 ? { routineFlowPositions: positions } : {}),
    };
  });

  /** Reads and checks a transfer file. A new file replaces the one the same owner read before. */
  readonly stage = Effect.fn("InstanceTransfer.stage")(function* (
    this: InstanceTransferService,
    path: string,
    owner = LOCAL_OWNER,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    return yield* this.#stageFile(path, owner, false, ARCHIVE);
  }).bind(this);

  /** A file that a member of a joined client sends: the service keeps it until the token ends. */
  readonly stageUpload = Effect.fn("InstanceTransfer.stageUpload")(function* (
    this: InstanceTransferService,
    read: () => Promise<Uint8Array>,
    owner: string,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    const directory = this.options.uploadDirectory;
    if (!directory) return yield* archiveFailure(new Error("Instance transfer uploads are not available."));
    const bytes = yield* archiveCall(() => read());
    yield* this.#prepareUploadDirectory(directory);
    const path = join(directory, `${randomUUID()}.zip`);
    yield* archiveCall(() => writeFile(path, bytes, { flag: "wx", mode: 0o600 }));
    return yield* this.#stageFile(path, owner, true, REMOTE_ARCHIVE).pipe(
      Effect.tapError(() => archiveCall(() => rm(path, { force: true })).pipe(Effect.ignore)),
    );
  }).bind(this);

  /** Clear files from the previous process before either writer creates a file. */
  readonly #prepareUploadDirectory = Effect.fn("InstanceTransfer.prepareUploadDirectory")(function* (
    this: InstanceTransferService,
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

  readonly #stageFile = Effect.fn("InstanceTransfer.stageFile")(function* (
    this: InstanceTransferService,
    path: string,
    owner: string,
    temporary: boolean,
    limits: ArchiveLimits,
  ): Effect.fn.Return<InstanceTransferPreview, ArchiveOperationError> {
    // The file read before stays staged until this one is checked, so a bad file keeps it.
    const archive = yield* readArchiveEffect(path, limits);
    const entries = archive.entries;
    if (!entries.has(INSTANCE_TRANSFER_MANIFEST))
      return yield* archiveFailure(new Error(sourceText("error.import.transferNotFile")));
    const manifestBytes =
      (yield* readEntriesEffect(archive, [INSTANCE_TRANSFER_MANIFEST], MANIFEST_MAX_BYTES))[
        INSTANCE_TRANSFER_MANIFEST
      ] ?? new Uint8Array();
    const { manifest, warnings } = yield* archiveSync(() => decodeTransferManifest(manifestBytes));
    if (archive.skipped) warnings.push(sourceText("error.import.foldersSkipped", { number: archive.skipped }));
    // An agent whose skill has no SKILL.md cannot import, so it is not offered.
    const agents = manifest.agents.filter((agent) => {
      const missing = agent.skills.find((skill) => !entries.has(`${skill}/SKILL.md`));
      if (missing) warnings.push(sourceText("error.import.skillFolderMissing", { name: agent.name, skill: missing }));
      return !missing;
    });
    const avatarPaths = new Set(agents.flatMap((agent) => (agent.avatar ? [agent.avatar] : [])));
    const avatarBytes = yield* readEntriesEffect(archive, avatarPaths, AVATAR_IMAGE_LIMITS.sourceBytes);
    const avatars = new Map<string, AvatarImageInput>();
    for (const agent of agents) {
      if (!agent.avatar) continue;
      const image = avatarImage(avatarBytes[agent.avatar]);
      if (image) avatars.set(agent.key, image);
      else warnings.push(sourceText("error.import.avatarSkipped", { name: agent.name }));
    }
    const existing = new Set(this.options.agents.listAgents().map((agent) => agent.name.toLowerCase()));
    const staged: StagedTransfer = {
      token: randomUUID(),
      owner,
      temporary,
      path,
      fingerprint: archive.fingerprint,
      manifest: { ...manifest, agents },
      avatars,
    };
    yield* this.#release(owner);
    this.#staged.set(staged.token, staged);
    if (temporary) {
      // A member who leaves the import open does not keep the file on the host.
      setTimeout(() => {
        if (this.#staged.get(staged.token) === staged) void Effect.runPromise(this.#drop(staged));
      }, UPLOAD_TTL_MS).unref();
    }
    return {
      token: staged.token,
      appVersion: manifest.appVersion,
      exportedAt: manifest.exportedAt,
      agents: agents.map((agent): AgentImportPreviewAgent => {
        const files = agent.files ? [...entries].filter(([name]) => name.startsWith(`${agent.files}/`)) : [];
        const avatar = avatars.get(agent.key);
        return {
          key: agent.key,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarUrl: avatar ? `data:${avatar.mimeType};base64,${Buffer.from(avatar.bytes).toString("base64")}` : null,
          skillCount: agent.skills.length,
          routineCount: transferRoutines(agent).length,
          memoryCount: agent.memories.length,
          fileCount: files.length,
          fileBytes: files.reduce((total, [, entry]) => total + entry.size, 0),
          nameExists: existing.has(agent.name.toLowerCase()),
        };
      }),
      hasSettings: manifest.settings !== null,
      warnings: bounded(warnings),
    };
  });

  readonly discard = Effect.fn("InstanceTransfer.discard")(function* (
    this: InstanceTransferService,
    token: string,
    owner = LOCAL_OWNER,
  ) {
    const staged = this.#staged.get(token);
    if (staged && staged.owner === owner) yield* this.#drop(staged);
  }).bind(this);

  readonly #release = Effect.fn("InstanceTransfer.release")(function* (this: InstanceTransferService, owner: string) {
    for (const staged of [...this.#staged.values()]) if (staged.owner === owner) yield* this.#drop(staged);
  });

  readonly #drop = Effect.fn("InstanceTransfer.drop")(function* (
    this: InstanceTransferService,
    staged: StagedTransfer,
  ) {
    this.#staged.delete(staged.token);
    if (staged.temporary) yield* archiveCall(() => rm(staged.path, { force: true })).pipe(Effect.ignore);
  });

  readonly apply = Effect.fn("InstanceTransfer.apply")(function* (
    this: InstanceTransferService,
    input: ApplyInstanceTransferInput,
    owner = LOCAL_OWNER,
    /** The caller's zone, for routines with no valid zone. A zone that is not valid reads as the host's. */
    timezone?: string,
    /** Who creates the channels: the member who imports, or the local user. */
    actor?: ChannelActor,
  ): Effect.fn.Return<InstanceTransferResult, ArchiveOperationError> {
    const staged = this.#staged.get(input.token);
    // Another member's token reads as a closed file, so the answer does not show that it exists.
    if (!staged || staged.owner !== owner)
      return yield* archiveFailure(new Error(sourceText("error.import.exportClosed")));
    this.#staged.delete(staged.token);
    const fallbackTimezone = timezone !== undefined && validTimezone(timezone) ? timezone : this.#timezone();
    return yield* this.#applyStaged(staged, input, fallbackTimezone, actor ?? this.options.channelActor()).pipe(
      Effect.ensuring(this.#drop(staged)),
    );
  }).bind(this);

  readonly #applyStaged = Effect.fn("InstanceTransfer.applyStaged")(function* (
    this: InstanceTransferService,
    staged: StagedTransfer,
    input: ApplyInstanceTransferInput,
    fallbackTimezone: string,
    actor: ChannelActor,
  ): Effect.fn.Return<InstanceTransferResult, ArchiveOperationError> {
    const selected = staged.manifest.agents.filter((agent) => input.keys.includes(agent.key));
    if (selected.length !== input.keys.length)
      return yield* archiveFailure(new Error(sourceText("error.import.agentNotInExport")));
    if (this.options.agents.listAgents().length + selected.length > INPUT_LIMITS.agents)
      return yield* archiveFailure(
        new Error(sourceText("error.import.serverAgentLimit", { limit: INPUT_LIMITS.agents })),
      );
    // The file can change after `stage`, so only the same central directory is accepted. Each entry
    // is checked against its size and CRC there when it is read.
    const archive = yield* readArchiveEffect(staged.path, staged.temporary ? REMOTE_ARCHIVE : ARCHIVE);
    if (archive.fingerprint !== staged.fingerprint)
      return yield* archiveFailure(new Error(sourceText("error.import.exportChanged")));

    const warnings: string[] = [];
    const settings = input.includeSettings ? staged.manifest.settings : null;
    // Providers and custom agents first, so their warnings come first. Their models are not listed yet:
    // a save does not wait for model discovery, and an imported provider has no key. An agent on one
    // of them starts on the default model, and the warning asks the user to choose the model again.
    if (settings) yield* this.#applyProviders(settings, warnings);

    const imported: AgentSummary[] = [];
    const skipped: AgentImportSkipped[] = [];
    const agentIds = new Map<string, string>();
    const routineIds = new Map<string, string>();
    for (const agent of selected) {
      const result = yield* Effect.result(
        this.#importAgent(archive, staged, agent, routineIds, warnings, fallbackTimezone),
      );
      if (Result.isFailure(result)) {
        skipped.push({ key: agent.key, name: agent.name, reason: message(result.failure.cause) });
      } else {
        imported.push(result.success);
        agentIds.set(agent.key, result.success.id);
      }
    }
    // Chats after every agent and routine exists, so each link in a message finds its copy. Their
    // files go to the upload folder, which a restart clears, in a folder with a random name.
    const uploads = this.options.uploadDirectory;
    const scratch = uploads ? yield* this.#prepareUploadDirectory(uploads).pipe(Effect.as(uploads)) : tmpdir();
    for (const agent of selected) {
      const agentId = agentIds.get(agent.key);
      if (!agentId || !agent.history) continue;
      yield* importHistory(
        archive,
        this.options.agents,
        {
          index: agent.history,
          agentId,
          agentName: agent.name,
          prefix: agentPrefix(agent.key),
          agentIds,
          routineIds,
          scratch,
          readerId: actor.id,
        },
        warnings,
      ).pipe(
        Effect.catch(() =>
          Effect.sync(() => warnings.push(sourceText("error.import.transferHistorySkipped", { name: agent.name }))),
        ),
      );
    }
    const channelIds = new Map<string, string>();
    for (const channel of staged.manifest.channels) {
      const result = yield* Effect.result(
        this.#importChannel(
          archive,
          channel,
          agentIds,
          routineIds,
          actor,
          staged.manifest.exporter,
          warnings,
          fallbackTimezone,
        ),
      );
      if (Result.isFailure(result))
        warnings.push(
          sourceText("error.import.transferSettingSkipped", {
            name: channel.name,
            reason: message(result.failure.cause),
          }),
        );
      else if (result.success) channelIds.set(channel.key, result.success);
    }
    if (settings?.workflows && this.options.settings.workflows)
      yield* importWorkflows(settings.workflows, this.options.settings.workflows, agentIds, channelIds, warnings);
    if (settings) yield* this.#applyLayout(settings, agentIds, routineIds, warnings);
    if (staged.manifest.shared) yield* this.#importShared(archive, staged.manifest.shared, warnings);

    const signedIn = new Set(this.options.settings.signedInProviders());
    return {
      agents: imported,
      skipped,
      signIn: staged.manifest.signedIn.filter((provider) => !signedIn.has(provider)),
      warnings: bounded(warnings),
    };
  });

  readonly #applyProviders = Effect.fn("InstanceTransfer.applyProviders")(function* (
    this: InstanceTransferService,
    settings: TransferSettings,
    warnings: string[],
  ) {
    const port = this.options.settings;
    const cleared = new Set(settings.cleared ?? []);
    /** `skipped` writes the warning for a step that fails, from its reason. */
    const attempt = function* (skipped: (reason: string) => string, effect: Effect.Effect<unknown, unknown>) {
      const result = yield* Effect.result(effect);
      if (Result.isFailure(result)) warnings.push(skipped(message(causeOf(result.failure))));
      return Result.isSuccess(result);
    };

    const providers = new Set(port.customProviders().map((provider) => provider.id));
    for (const provider of settings.customProviders) {
      if (providers.has(provider.id)) continue;
      const saved = yield* attempt(
        named(provider.name),
        port.saveCustomProvider({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: null,
          models: provider.models.map(({ id, name, contextWindow, maxOutput, reasoningEfforts, inputs }) => ({
            id,
            name,
            ...(isCustomProviderContextWindow(contextWindow) ? { contextWindow } : {}),
            ...(isCustomProviderMaxOutput(maxOutput) ? { maxOutput } : {}),
            ...(isCustomProviderReasoningEfforts(reasoningEfforts) ? { reasoningEfforts: [...reasoningEfforts] } : {}),
            ...(isCustomProviderInputs(inputs) ? { inputs: [...inputs] } : {}),
          })),
          headers: [],
          ...(isCustomProviderHarness(provider.harness) ? { harness: provider.harness } : {}),
        }),
      );
      if (saved && provider.needsApiKey)
        warnings.push(sourceText("error.import.transferProviderKey", { name: provider.name }));
      if (saved && cleared.has(provider.name))
        warnings.push(sourceText("error.import.transferValuesCleared", { name: provider.name }));
    }

    // Saving a custom agent starts its command to list its models, so the import never saves one.
    // The warning names the command, and the user adds the agent again after checking it.
    const customAgents = new Set((yield* Effect.orElseSucceed(port.customAgents(), () => [])).map((agent) => agent.id));
    for (const agent of settings.customAgents) {
      if (customAgents.has(agent.id)) continue;
      const command = [agent.command, ...agent.args].join(" ");
      warnings.push(sourceText("error.import.transferCustomAgentCommand", { name: agent.name, command }));
      if (agent.envNames.length > 0)
        warnings.push(
          sourceText("error.import.transferAgentEnv", { name: agent.name, names: agent.envNames.join(", ") }),
        );
    }

    const servers = new Set(port.mcpServers().map((server) => server.name.toLowerCase()));
    for (const server of settings.mcpServers) {
      if (servers.has(server.name.toLowerCase())) continue;
      // A file can name any command, so an imported server stays off until the user checks it.
      const saved = yield* attempt(named(server.name), port.saveMcpServer({ ...server, id: "", enabled: false }));
      if (saved) warnings.push(sourceText("error.import.transferMcpValues", { name: server.name }));
    }
  });

  readonly #applyLayout = Effect.fn("InstanceTransfer.applyLayout")(function* (
    this: InstanceTransferService,
    settings: TransferSettings,
    agentIds: ReadonlyMap<string, string>,
    routineIds: ReadonlyMap<string, string>,
    warnings: string[],
  ) {
    const port = this.options.settings;
    let layout = port.sidebar();
    for (const section of settings.sidebarSections) {
      const members = section.agentKeys.flatMap((key) => {
        const id = agentIds.get(key);
        return id ? [id] : [];
      });
      if (members.length === 0) continue;
      let target = layout.sections.find((candidate) => candidate.name.toLowerCase() === section.name.toLowerCase());
      if (!target) {
        const before = new Set(layout.sections.map((candidate) => candidate.id));
        const created = yield* Effect.result(port.mutateSidebar({ type: "create", name: section.name }));
        if (Result.isFailure(created)) {
          warnings.push(
            sourceText("error.import.transferSettingSkipped", {
              name: section.name,
              reason: message(causeOf(created.failure)),
            }),
          );
          continue;
        }
        layout = created.success;
        target = layout.sections.find((candidate) => !before.has(candidate.id));
      }
      if (!target) continue;
      for (const agentId of members) {
        const assigned = yield* Effect.result(port.mutateSidebar({ type: "assign", agentId, sectionId: target.id }));
        if (Result.isSuccess(assigned)) layout = assigned.success;
      }
    }

    for (const link of settings.routineFlows) {
      const routineId = routineIds.get(link.routineKey);
      const fromAgentId = agentIds.get(link.fromAgentKey);
      const toAgentId = agentIds.get(link.toAgentKey);
      if (!routineId || !fromAgentId || !toAgentId) continue;
      const connected = yield* Effect.result(
        port.connectRoutineFlow({ routineId, fromAgentId, toAgentId, instruction: link.instruction }),
      );
      if (Result.isFailure(connected))
        warnings.push(
          sourceText("error.import.transferRoutineFlowSkipped", { reason: message(causeOf(connected.failure)) }),
        );
    }

    // A place on a canvas only helps the user find a node again, so one that fails is left out.
    for (const position of settings.routineFlowPositions ?? []) {
      const agentId = agentIds.get(position.agentKey);
      const [kind, key] = position.nodeKey.split(":", 2);
      const id =
        kind === "agent" ? agentIds.get(key ?? "") : kind === "routine" ? routineIds.get(key ?? "") : undefined;
      if (!agentId || !id || !port.saveRoutineFlowPosition) continue;
      yield* port
        .saveRoutineFlowPosition({ agentId, nodeKey: `${kind}:${id}`, x: position.x, y: position.y })
        .pipe(Effect.ignore);
    }
  });

  /** Copies `~/OpenBot/Shared` files. A file that is already here is kept as it is. */
  readonly #importShared = Effect.fn("InstanceTransfer.importShared")(function* (
    this: InstanceTransferService,
    archive: ArchiveFile,
    folder: string,
    warnings: string[],
  ) {
    const files = [...archive.entries.values()].filter((entry) => entry.name.startsWith(`${folder}/`));
    const base = resolve(this.options.sharedRoot);
    let kept = 0;
    if (files.length)
      yield* withArchive(archive.path, (handle) =>
        Effect.gen(function* () {
          for (const entry of files) {
            const inner = entry.name.slice(folder.length + 1);
            const target = resolve(base, inner);
            if (isUnsafeEntry(inner) || isSharedData(inner) || !isPathInside(base, target)) continue;
            const written = yield* Effect.result(
              Effect.gen(function* () {
                yield* archiveCall(() => mkdir(dirname(target), { recursive: true }));
                yield* extractEntryEffect(handle, entry, target, entry.executable ? 0o777 : 0o666);
              }),
            );
            if (Result.isFailure(written)) kept += 1;
          }
        }),
      );
    if (kept > 0) warnings.push(sourceText("error.import.transferSharedKept", { number: kept }));
  });

  /** The routines of an agent or a channel that a webhook starts. */
  readonly #readWebhookRoutines = Effect.fn("InstanceTransfer.readWebhookRoutines")(function* (
    this: InstanceTransferService,
    owner: EventRoutineOwner,
  ) {
    const port = this.options.webhookRoutines;
    if (!port) return [];
    const routines = yield* port.list(owner).pipe(Effect.orElseSucceed((): EventRoutine[] => []));
    return routines.flatMap((routine): TransferWebhookRoutine[] =>
      routine.trigger.kind === "webhook"
        ? [
            {
              key: routine.id,
              name: routine.name,
              instruction: routine.instruction,
              active: routine.active,
              timezone: routine.timezone,
              eventType: routine.trigger.eventType,
              filters: routine.trigger.filters,
              ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
              ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
              ...(routine.runIn ? { runIn: routine.runIn } : {}),
            },
          ]
        : [],
    );
  });

  /**
   * Adds the routines that a webhook starts. Each one gets a new address and secret here, which the
   * user gives to the sender, so each one is a warning that says so.
   */
  readonly #importWebhookRoutines = Effect.fn("InstanceTransfer.importWebhookRoutines")(function* (
    this: InstanceTransferService,
    owner: EventRoutineOwner,
    values: readonly unknown[],
    ownerName: string,
    routineIds: Map<string, string>,
    warnings: string[],
    fallbackTimezone: string,
    /** The owner is an agent that its source app had stopped, so each routine is added turned off. */
    routinesOff = false,
  ) {
    const port = this.options.webhookRoutines;
    if (!port) return;
    for (const value of values) {
      const routine = decodeWebhookRoutine(value);
      if (!routine) continue;
      const saved = yield* Effect.result(
        port.save({
          owner,
          name: routine.name,
          instruction: routine.instruction,
          active: routine.active && !routinesOff,
          timezone: validTimezone(routine.timezone) ? routine.timezone : fallbackTimezone,
          trigger: routine.trigger,
          ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
          ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
          ...(owner.kind === "agent" && routine.runIn ? { runIn: routine.runIn } : {}),
        }),
      );
      if (Result.isFailure(saved)) {
        warnings.push(
          sourceText("error.import.routineSkipped", {
            name: ownerName,
            routine: routine.name,
            reason: message(causeOf(saved.failure)),
          }),
        );
        continue;
      }
      routineIds.set(routine.key, saved.success.routine.id);
      warnings.push(sourceText("error.import.transferRoutineWebhook", { name: ownerName, routine: routine.name }));
    }
  });

  /** Creates a channel of the imported members. A step that fails deletes it, and the others go on. */
  readonly #importChannel = Effect.fn("InstanceTransfer.importChannel")(function* (
    this: InstanceTransferService,
    archive: ArchiveFile,
    source: TransferChannel,
    agentIds: ReadonlyMap<string, string>,
    routineIds: Map<string, string>,
    actor: ChannelActor,
    exporter: string | null,
    warnings: string[],
    fallbackTimezone: string,
  ): Effect.fn.Return<string | null, ArchiveOperationError> {
    const members = source.members.flatMap((key) => {
      const agentId = agentIds.get(key);
      return agentId ? [{ agentId }] : [];
    });
    // The user did not import any member: the channel is not offered.
    if (members.length === 0) return null;
    const leadAgentId = source.lead ? (agentIds.get(source.lead) ?? null) : null;
    const draft = {
      name: source.name,
      title: source.title,
      instructions: source.instructions,
      members,
      leadAgentId,
      ...(source.isolated === undefined ? {} : { isolated: source.isolated }),
      // A value this version cannot read, such as a kind from a later version, gives the browser to no member.
      ...(source.browser === undefined
        ? {}
        : {
            browser: isChannelBrowser(source.browser)
              ? transferBrowser(source.browser, (key) => agentIds.get(key))
              : { kind: "none" as const },
          }),
      ...(isChannelIcon(source.icon) ? { icon: source.icon } : {}),
    };
    if (!isChannelDraft(draft)) return yield* archiveFailure(new Error(sourceText("error.import.transferNotFile")));
    const image = source.image
      ? avatarImage((yield* readEntriesEffect(archive, [source.image], AVATAR_IMAGE_LIMITS.sourceBytes))[source.image])
      : null;
    if (source.image && !image) warnings.push(sourceText("error.import.avatarSkipped", { name: source.name }));

    const port = this.options.agents;
    let completed = false;
    return yield* Effect.acquireUseRelease(
      port.channels
        .command({ type: "save", operationId: randomUUID(), channelId: randomUUID(), draft }, actor)
        .pipe(Effect.mapError(failure)),
      (channel) =>
        Effect.gen({ self: this }, function* () {
          if (image) yield* port.channels.setImage(channel.id, image).pipe(Effect.mapError(failure));
          // A memory that this computer refuses, such as a repeated text, is left out.
          for (const text of source.memories)
            yield* archiveSync(() => port.createChannelMemory({ channelId: channel.id, text })).pipe(Effect.ignore);
          for (const routine of source.routines) {
            const created = yield* archiveSync(() =>
              port.createChannelRoutine({
                channelId: channel.id,
                name: routine.name,
                instruction: routine.instruction,
                active: routine.active,
                timezone: validTimezone(routine.timezone) ? routine.timezone : fallbackTimezone,
                schedule: routine.schedule,
                ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
                ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
              }),
            ).pipe(Effect.result);
            if (Result.isSuccess(created)) routineIds.set(routine.key, created.success.id);
            else
              warnings.push(
                sourceText("error.import.routineSkipped", {
                  name: source.name,
                  routine: routine.name,
                  reason: message(created.failure.cause),
                }),
              );
          }
          yield* this.#importWebhookRoutines(
            { kind: "channel", id: channel.id },
            source.webhookRoutines ?? [],
            source.name,
            routineIds,
            warnings,
            fallbackTimezone,
          );
          if (source.messages?.length) {
            yield* importChannelMessages(archive, port.channels, {
              channelId: channel.id,
              parts: source.messages,
              prefix: channelPrefix(source.key),
              agentIds,
              exporter,
              actor,
            });
            // The history was read on the other computer, so it does not arrive unread. The command
            // also tells the open views about the messages.
            const last = port.channels.store.messages(channel.id, undefined, 1).at(-1);
            if (last)
              yield* port.channels
                .command(
                  { type: "read", operationId: randomUUID(), channelId: channel.id, throughSequence: last.sequence },
                  actor,
                )
                .pipe(Effect.mapError(failure));
          }
          if (source.archived)
            yield* port.channels
              .command({ type: "archive", operationId: randomUUID(), channelId: channel.id }, actor)
              .pipe(Effect.mapError(failure));
          completed = true;
          return channel.id;
        }),
      (channel) => (completed ? Effect.void : port.deleteChannel(channel.id).pipe(Effect.ignore)),
    );
  });

  readonly #importAgent = Effect.fn("InstanceTransfer.importAgent")(function* (
    this: InstanceTransferService,
    archive: ArchiveFile,
    staged: StagedTransfer,
    source: TransferAgent,
    routineIds: Map<string, string>,
    warnings: string[],
    fallbackTimezone: string,
  ): Effect.fn.Return<AgentSummary, ArchiveOperationError> {
    const prefix = agentPrefix(source.key);
    const agentEntries = [...archive.entries.values()].filter((entry) => entry.name.startsWith(prefix));
    /** The entries under a folder of the file, by their names in that folder. */
    const under = (path: string) =>
      agentEntries
        .filter((entry) => entry.name.startsWith(`${path}/`))
        .map((entry) => [entry.name.slice(path.length + 1), entry] as const);
    // Every skill is checked before the agent exists, so a bad one publishes nothing.
    const skills: Array<{ files: Array<readonly [string, Uint8Array]>; slug: string }> = [];
    for (const skill of source.skills) skills.push(yield* readSkillEffect(archive, under(skill)));
    // The model is kept when this computer offers it, and the provider is on.
    const model = this.options.agents
      .listModels()
      .find((option) => option.provider === source.provider && option.id === source.model);
    const useModel = model !== undefined && !this.options.settings.providersOff().includes(source.provider);
    if (!useModel)
      warnings.push(sourceText("error.import.transferModelMissing", { name: source.name, model: source.model }));

    const published: Array<{ id: string; revision: number }> = [];
    let completed = false;
    return yield* Effect.acquireUseRelease(
      this.options.agents
        .createAgentProfile({
          name: source.name,
          ...(source.title ? { title: source.title } : {}),
          description: source.description,
          avatarSeed: AVATAR_SEED_PATTERN.test(source.avatarSeed) ? source.avatarSeed : `${source.key}-${randomUUID()}`,
          avatarHue: source.avatarHue,
          ...(isAvatarColor(source.avatarColor) ? { avatarColor: source.avatarColor } : {}),
          ...(useModel
            ? { provider: source.provider, model: source.model, reasoningEffort: source.reasoningEffort }
            : {}),
        })
        .pipe(Effect.mapError(failure)),
      (created) =>
        Effect.gen({ self: this }, function* () {
          let agent = created;
          if (source.files) {
            yield* writeImportedFilesEffect(
              agent.workspacePath,
              archive,
              under(source.files).filter(([name]) => !isWorkspaceSkipped(name)),
              source.name,
              warnings,
              true,
            );
          }
          const library = this.options.skills.library();
          for (const skill of skills) {
            const current = (yield* library.list().pipe(Effect.mapError(failure))).find(
              (candidate) => candidate.slug === skill.slug,
            );
            const folder = `${SKILL_STAGING}/${skill.slug}`;
            const target = join(agent.workspacePath, ...folder.split("/"));
            yield* Effect.acquireUseRelease(
              Effect.succeed(target),
              () =>
                Effect.gen({ self: this }, function* () {
                  yield* writeTreeEffect(target, skill.files);
                  const revision = yield* (
                    current
                      ? library.revise(agent.id, current.id, current.version, folder)
                      : library.create(agent.id, folder)
                  ).pipe(Effect.mapError(failure), Effect.uninterruptible);
                  published.push({ id: revision.id, revision: revision.version });
                  yield* this.options.skills
                    .installLocal({ agentId: agent.id, skillId: revision.id, revision: revision.version })
                    .pipe(Effect.mapError(failure), Effect.uninterruptible);
                }),
              () => archiveCall(() => rm(target, { recursive: true, force: true })),
            );
          }

          const routinesOff = hiddenAgentWasStopped(source.preferences);
          for (const routine of transferRoutines(source)) {
            const created = yield* archiveSync(() =>
              this.options.agents.createRoutine(
                {
                  agentId: agent.id,
                  name: routine.name,
                  instruction: routine.instruction,
                  active: routine.active && !routinesOff,
                  timezone: validTimezone(routine.timezone) ? routine.timezone : fallbackTimezone,
                  schedule: routine.schedule,
                  ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
                  ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
                  ...(routine.runIn ? { runIn: routine.runIn } : {}),
                },
                { recordConversationEvent: false },
              ),
            ).pipe(Effect.result);
            if (Result.isSuccess(created)) routineIds.set(routine.key, created.success.id);
            else
              warnings.push(
                sourceText("error.import.routineSkipped", {
                  name: source.name,
                  routine: routine.name,
                  reason: message(created.failure.cause),
                }),
              );
          }

          yield* this.#importWebhookRoutines(
            { kind: "agent", id: agent.id },
            source.webhookRoutines ?? [],
            source.name,
            routineIds,
            warnings,
            fallbackTimezone,
            routinesOff,
          );

          // The limit can be lower here than on the computer that made the file.
          const memoryLimit = this.options.agents.memoryLimit();
          if (source.memories.length > memoryLimit)
            warnings.push(sourceText("error.import.memoryLimit", { name: source.name, limit: memoryLimit }));
          const chosen = yield* archiveSync(() =>
            source.memories.slice(0, memoryLimit).flatMap((memory) => {
              const created = this.options.agents.createMemory({ agentId: agent.id, text: memory.text });
              return memory.inclusion ? [{ memoryId: created.id, inclusion: memory.inclusion }] : [];
            }),
          );
          yield* archiveSync(() => this.options.agents.initializeMemorySelection(agent.id));
          if (chosen.length > 0) {
            const revisions = new Map(
              this.options.agents
                .getMemorySelection(agent.id)
                .selections.map((selection) => [selection.memoryId, selection.revision]),
            );
            yield* archiveSync(() =>
              this.options.agents.setMemoryInclusion({
                agentId: agent.id,
                changes: chosen.map((change) => ({ ...change, expectedRevision: revisions.get(change.memoryId) ?? 0 })),
              }),
            ).pipe(Effect.ignore);
          }

          const avatar = staged.avatars.get(source.key);
          if (avatar) agent = yield* this.options.agents.setAvatar(agent.id, avatar).pipe(Effect.mapError(failure));
          agent = yield* this.options.agents
            .updateAgent({
              agentId: agent.id,
              notifications: source.notifications,
              ...(source.busyMessageMode ? { busyMessageMode: source.busyMessageMode } : {}),
              ...(source.taskLimit === undefined ? {} : { taskLimit: source.taskLimit }),
              ...(isAvatarColor(source.chatColor) ? { chatColor: source.chatColor } : {}),
            })
            .pipe(Effect.mapError(failure));
          // Every step here is a warning when it fails, so the agent stays.
          yield* applyPreferences(
            agent,
            source.preferences,
            this.options.agents,
            this.options.preferences ?? null,
            staged.owner === LOCAL_OWNER,
            warnings,
          );
          completed = true;
          return agent;
        }),
      (agent) =>
        completed
          ? Effect.void
          : Effect.gen({ self: this }, function* () {
              yield* this.options.agents.deleteAgent(agent.id).pipe(Effect.ignore);
              for (const skill of published.reverse())
                yield* this.options.skills.library().withdraw(skill.id, skill.revision).pipe(Effect.ignore);
            }).pipe(Effect.orDie),
    );
  });
}

/**
 * The files an export carries from one folder: no link, nothing `isUnsafeArchivePath` refuses on
 * import (`.git`, `node_modules`, `.env*`, private keys, nested archives), and not OpenBot's own
 * workspace folders.
 */
const workspaceFiles = Effect.fn("InstanceTransfer.workspaceFiles")(function* (
  root: string,
): Effect.fn.Return<FileEntry[], ArchiveOperationError> {
  return yield* walk(root, isWorkspaceSkipped);
});

/** OpenBot's own workspace folders: an export leaves them out, and an import never writes them. */
function isWorkspaceSkipped(name: string): boolean {
  // A disk that ignores case writes `.OpenBot/` into `.openbot/`, so the check ignores case too.
  const lower = name.toLowerCase();
  return WORKSPACE_SKIPPED.some((skipped) => lower === skipped || lower.startsWith(`${skipped}/`));
}

const walk = Effect.fn("InstanceTransfer.walk")(function* (
  root: string,
  skip: (name: string) => boolean = () => false,
): Effect.fn.Return<FileEntry[], ArchiveOperationError> {
  const files: FileEntry[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop() ?? root;
    const listed = yield* Effect.result(archiveCall(() => readdir(directory, { withFileTypes: true })));
    // A missing folder has no files: a new agent may not have a workspace yet. A folder that cannot
    // be read stops the export, as a file that cannot be read does, so no file is left out silently.
    if (Result.isFailure(listed)) {
      if (isMissingFileError(listed.failure.cause)) continue;
      return yield* listed.failure;
    }
    for (const entry of listed.success) {
      const path = join(directory, entry.name);
      const name = relative(root, path).split(sep).join("/");
      if (skip(name) || isUnsafeArchivePath(name)) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        // A running agent can delete a file between `readdir` and `lstat`; that file is not exported.
        const info = yield* Effect.result(archiveCall(() => lstat(path)));
        if (Result.isSuccess(info))
          files.push({ name, path, size: info.success.size, executable: (info.success.mode & 0o111) !== 0 });
        else if (!isMissingFileError(info.failure.cause)) return yield* info.failure;
      }
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
});

/**
 * The skills a user or a marketplace installed, with a pack as one skill. OpenBot's own skills are
 * installed again on import.
 */
const skillFolders = Effect.fn("InstanceTransfer.skillFolders")(function* (
  workspace: string,
): Effect.fn.Return<Array<{ slug: string; files: FileEntry[] }>, ArchiveOperationError> {
  const skills = new Map<string, FileEntry[]>();
  for (const folder of MANAGED_SKILL_FOLDERS) {
    const root = join(workspace, ...folder.split("/"));
    const listed = yield* Effect.result(archiveCall(() => readdir(root)));
    if (Result.isFailure(listed)) {
      if (isMissingFileError(listed.failure.cause)) continue;
      return yield* listed.failure;
    }
    for (const slug of listed.success) {
      if (skills.has(slug) || isUnsafeArchivePath(slug)) continue;
      const directory = join(root, slug);
      // `stat` follows a link: `npx skills` links each skill folder to one shared copy.
      const info = yield* Effect.result(archiveCall(() => stat(directory)));
      // A link to a skill that is gone is not a skill.
      if (Result.isFailure(info) && !isMissingFileError(info.failure.cause)) return yield* info.failure;
      if (Result.isFailure(info) || !info.success.isDirectory()) continue;
      const files = yield* walk(directory);
      if (files.some((file) => file.name === OWNERSHIP_MARKER) || !files.some((file) => file.name === "SKILL.md"))
        continue;
      skills.set(slug, files);
    }
  }
  // A pack is one skill, as in its marketplace bundle: its skills go back to `skills/<folder>/` of the
  // pack, and the install on import writes each one as a folder of its own again. When the lock
  // cannot be read, each folder stays a skill of its own.
  const packs = yield* readPackFolders(workspace).pipe(Effect.orElseSucceed(() => new Map<string, string[]>()));
  for (const [slug, children] of packs) {
    const pack = skills.get(slug);
    if (!pack) continue;
    for (const child of children) {
      for (const file of skills.get(child) ?? []) pack.push({ ...file, name: `skills/${child}/${file.name}` });
      skills.delete(child);
    }
  }
  return [...skills].sort(([a], [b]) => a.localeCompare(b)).map(([slug, files]) => ({ slug, files }));
});

/** A flag, a `KEY=value` argument or a header line whose name says it holds a secret. */
const SECRET_NAME = /token|secret|password|passwd|api[-_]?key|apikey|auth|credential|private[-_]?key|access[-_]?key/iu;

/**
 * Removes values that can hold a secret from MCP and custom agent arguments and from URLs, and
 * records whose values it removed, so the import can ask for them again.
 */
export function createRedaction() {
  const names = new Set<string>();
  const url = (owner: string, value: string): string => {
    if (!value) return value;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return value;
    }
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash) return value;
    names.add(owner);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  };
  return {
    args(owner: string, args: readonly string[]): string[] {
      return args.map((arg, index) => {
        const separator = /[=:]/u.exec(arg);
        if (separator && separator.index > 0 && SECRET_NAME.test(arg.slice(0, separator.index))) {
          names.add(owner);
          return arg.slice(0, separator.index + 1);
        }
        const flag = args[index - 1];
        if (!arg.startsWith("-") && flag?.startsWith("-") && !/[=:]/u.test(flag) && SECRET_NAME.test(flag)) {
          names.add(owner);
          return "";
        }
        // A connection string keeps its password in the URL, as a positional value or after `=`.
        const equals = arg.indexOf("=");
        if (equals > 0) return arg.slice(0, equals + 1) + url(owner, arg.slice(equals + 1));
        return url(owner, arg);
      });
    },
    url,
    /** Only the origin of an MCP address: some services keep the access key in the path. */
    origin(owner: string, value: string): string {
      if (!value) return value;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return value;
      }
      if (`${parsed.origin}/` === parsed.href || parsed.origin === parsed.href) return value;
      names.add(owner);
      return parsed.origin;
    },
    cleared: () => [...names],
  };
}

/** The warning for an item of the settings that is not imported. */
function named(name: string): (reason: string) => string {
  return (reason) => sourceText("error.import.transferSettingSkipped", { name, reason });
}

/** A routine that a webhook starts, checked as a save checks it. */
function decodeWebhookRoutine(value: unknown) {
  if (!isDynamicRecord(value)) return null;
  const { key, name, instruction, active, timezone, eventType, filters, limitPolicy, missedPolicy, runIn } = value;
  const trigger = { kind: "webhook" as const, eventType, filters };
  if (
    typeof key !== "string" ||
    typeof name !== "string" ||
    typeof instruction !== "string" ||
    typeof active !== "boolean" ||
    typeof timezone !== "string" ||
    !isEventRoutineTriggerInput(trigger) ||
    trigger.kind !== "webhook"
  )
    return null;
  return {
    key,
    name,
    instruction,
    active,
    timezone,
    trigger,
    limitPolicy: ROUTINE_LIMIT_POLICIES.find((known) => known === limitPolicy),
    missedPolicy: ROUTINE_MISSED_POLICIES.find((known) => known === missedPolicy),
    runIn: ROUTINE_RUN_PLACES.find((known) => known === runIn),
  };
}

/** A canvas node key in the file: an agent by its key, a routine by its key. Others are left out. */
function filePositionKey(
  nodeKey: string,
  agentKeys: ReadonlyMap<string, string>,
  routineKeys: ReadonlySet<string>,
): string | null {
  const [kind, id] = nodeKey.split(":", 2);
  if (kind === "agent" && id) {
    const key = agentKeys.get(id);
    return key ? `agent:${key}` : null;
  }
  return kind === "routine" && id && routineKeys.has(id) ? nodeKey : null;
}

/** A routine of an agent or a channel, as the file keeps it. */
function transferRoutine(routine: Routine | ChannelRoutine): TransferAgent["routines"][number] {
  return {
    key: routine.id,
    name: routine.name,
    instruction: routine.instruction,
    active: routine.active,
    timezone: routine.timezone,
    schedule: routine.trigger.schedule,
    ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
    ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
    ...("runIn" in routine && routine.runIn ? { runIn: routine.runIn } : {}),
  };
}

/** The routines of an agent in a file, with the one-time routines that older apps skip. */
function transferRoutines(agent: TransferAgent): TransferAgent["routines"] {
  return [...agent.routines, ...(agent.oneTimeRoutines ?? [])];
}

/** The Shared folders that a transfer never copies as files. */
function isSharedData(name: string): boolean {
  const lower = name.toLowerCase();
  return [SHARED_DATA, SHARED_TRANSFERS].some((folder) => lower === folder || lower.startsWith(`${folder}/`));
}

/** An export that is read and checked, and not written yet. */
export interface PreparedExport {
  write(path: string): Effect.Effect<InstanceExportResult, ArchiveOperationError>;
}

interface ZipEntry {
  name: string;
  read: () => Promise<Uint8Array>;
  executable?: boolean;
}

/** Writes the archive to `<path>.part` one file at a time, then renames it. */
const writeZipEffect = Effect.fn("InstanceTransfer.writeZip")(function* (
  path: string,
  entries: ReadonlyArray<ZipEntry>,
): Effect.fn.Return<number, ArchiveOperationError> {
  const part = `${path}.part`;
  return yield* archiveCall(async () => {
    let gone = 0;
    const handle = await open(part, "w");
    try {
      let pending = Promise.resolve();
      let error: unknown = null;
      const zip = new Zip((failure, chunk) => {
        if (failure) error = failure;
        else pending = pending.then(() => handle.write(chunk).then(() => undefined));
      });
      for (const entry of entries) {
        let data: Uint8Array;
        try {
          data = await entry.read();
        } catch (cause) {
          // A running agent can delete a file after the walk; the export goes on without it.
          if (!isMissingFileError(cause)) throw cause;
          gone += 1;
          continue;
        }
        // Stored, not compressed: compression would run on the main thread.
        const file = new ZipPassThrough(entry.name);
        if (entry.executable !== undefined) {
          // A Unix mode, as Git keeps it: only if the file is executable. The import restores the bits.
          file.os = 3;
          file.attrs = (entry.executable ? 0o100755 : 0o100644) * 0x10000;
        }
        zip.add(file);
        file.push(data, true);
        await pending;
        if (error) throw error;
      }
      zip.end();
      await pending;
      if (error) throw error;
    } finally {
      await handle.close();
    }
    await rename(part, path);
    return gone;
  }).pipe(Effect.tapError(() => archiveCall(() => rm(part, { force: true })).pipe(Effect.ignore)));
});

function failure(error: unknown): ArchiveOperationError {
  return archiveFailure(causeOf(error));
}

/** A service error keeps the original error as its cause. */
function causeOf(error: unknown): Error {
  if (error instanceof Error && error.cause instanceof Error) return error.cause;
  return error instanceof Error ? error : new Error("The import failed.");
}

function bounded(warnings: string[]): string[] {
  return warnings.slice(0, AGENT_IMPORT_LIMITS.warnings).map((text) => text.slice(0, AGENT_IMPORT_LIMITS.message));
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : "The import failed.";
  return text.slice(0, AGENT_IMPORT_LIMITS.message);
}

/**
 * The browser rule with its member mapped between agent ids and archive keys. A named member that is not
 * in the file, or that the user did not import, gives the browser to no member: the rule never opens up.
 */
function transferBrowser(browser: ChannelBrowser, map: (id: string) => string | undefined): ChannelBrowser {
  if (browser.kind !== "member") return browser;
  const agentId = map(browser.agentId);
  return agentId ? { kind: "member", agentId } : { kind: "none" };
}
