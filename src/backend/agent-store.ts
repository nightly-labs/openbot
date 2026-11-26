import { createHash, randomUUID } from "node:crypto";
import { type CopyOptions, createReadStream, promises as nodeFsPromises } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rmdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { avatarFileExtension, isAvatarMimeType, isValidAvatarImage } from "@openbot/contracts/avatar-images";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentProfileDraft } from "@openbot/contracts/ipc";
import {
  AGENT_FOLDER_LIMIT,
  AGENT_PROVIDERS,
  type AgentAccess,
  type AgentBackupModels,
  type AgentDefaults,
  type AgentModelId,
  type AgentPendingRuntime,
  type AgentProviderId,
  type AgentReasoningEffort,
  type AgentSessionSettingOverrides,
  type AgentSummary,
  type AgentUsageLimitReturn,
  type AvatarColor,
  type AvatarHue,
  type AvatarImageInput,
  type BusyMessageMode,
  type CreateAgentInput,
  DEFAULT_AGENT_ACCESS,
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type DuplicateAgentResult,
  decodeAgentProfileDraft,
  decodeSaveAgentProfileResult,
  defaultProviderModel,
  isAgentAccess,
  isAgentAdditionalFolders,
  isAgentBackupModels,
  isAgentModel,
  isAgentPendingRuntime,
  isAgentSessionSettingOverrides,
  isAgentSessionSettingResets,
  isAgentTaskLimit,
  isAgentUsageLimitReturn,
  isAvatarColor,
  isAvatarHue,
  isAvatarSeed,
  isBrowserProfileId,
  isBusyMessageMode,
  isHiddenAt,
  isProviderAccountId,
  isReasoningEffort,
  isSidebarLayoutSnapshot,
  nearestAvatarHue,
  providerForLegacyModel,
  type SaveAgentProfileResult,
  type SidebarLayoutSnapshot,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { isGeneratedAgentId, isUuidV4, legacyAgentId } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Result, Semaphore, Stream } from "effect";
import { ProfileCreationRecovery } from "./agent/profile-creation-recovery";
import { isEmptyStoredFile, isHeldTargetError, parseStoredJson, writeFileAtomically } from "./atomic-json-file";
import { automationRoot } from "./automation-command";
import type { AgentModelChange } from "./database/agent-roster";
import { type OpenBotDatabase, type ProviderSession, stableThreadId } from "./openbot-database";
import { isPathInside } from "./path-containment";
import { isRecord } from "./protocol";
import { StoredStateFailure, storedIO, storedSync } from "./stored-state-effects";

type StoredAgent = AgentSummary & { access: AgentAccess; computerUse: boolean };
type PersistedStoredAgent = Omit<StoredAgent, "avatarUrl" | "provider" | "access" | "computerUse"> & {
  avatarUrl?: string | null;
  provider?: AgentProviderId;
  access?: AgentAccess;
  computerUse?: boolean;
  additionalFolders?: string[];
  excludedFolders?: string[];
  allowAutomation?: boolean;
  allowNewChat?: boolean;
  quickAcknowledgement?: boolean;
  ownBrowserSession?: boolean;
  browserProfileId?: string;
  fastMode?: boolean;
  ultrafast?: boolean;
  busyMessageMode?: BusyMessageMode;
  taskLimit?: number;
  providerAccountId?: string;
  backupModels?: AgentBackupModels;
  usageLimitReturn?: AgentUsageLimitReturn;
  pendingRuntime?: AgentPendingRuntime;
  pinnedAccountId?: string;
  hiddenAt?: string;
};
type StoredAgentBase = Omit<PersistedStoredAgent, "avatarSeed" | "avatarHue"> & DynamicRecord;

interface AgentDuplicationMarker {
  operationId: string;
  sourceAgentId: string;
}

interface StoredState {
  version: 2;
  examplesInitialized: boolean;
  agents: StoredAgent[];
}

type LegacyStoredAgent = Omit<PersistedStoredAgent, "avatarSeed" | "avatarHue" | "avatarColor"> & {
  avatarShape: string;
  avatarColor: string;
};

const LEGACY_AVATAR_VARIANTS = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"] as const;
const LEGACY_AVATAR_COLORS = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
  "gray",
] as const;

const NEW_AGENT_PREVIEW = "No messages yet";
const AGENT_PREVIEW_MAX_LENGTH = 180;
const DEFAULT_AGENT_MODEL: AgentModelId = "gpt-6-luna";
export const DEFAULT_AGENT_PROVIDER: AgentProviderId = "codex";
const DEFAULT_REASONING_EFFORT: AgentReasoningEffort = "low";

const LEGACY_AGENTS_STATE_FILE = "bots.json";
const LEGACY_AGENTS_STATE_KEY = "bots";
const LEGACY_AGENTS_IMPORT_COMMAND_ID = "legacy-import:bots:v1";
const CLAUDE_FAST_MODE_RESET_COMMAND_ID = "agent-fast-mode:claude-reset:v1";

const logger = createOpenBotLogger("agent-store");

const fsPromisesWithoutAsarArchives: typeof nodeFsPromises = process.versions.electron
  ? createRequire(import.meta.url)("original-fs").promises
  : nodeFsPromises;

const { rm } = fsPromisesWithoutAsarArchives;

const AGENT_FILES_REMOVAL = { recursive: true, force: true, maxRetries: 10, retryDelay: 150 } as const;

const OWNER_FULL_ACCESS = 0o700;

async function removeAgentFiles(path: string): Promise<void> {
  try {
    await rm(path, AGENT_FILES_REMOVAL);
  } catch (error) {
    if (process.platform === "win32" || !isPermissionRefusal(error)) throw error;
    await grantOwnerFolderAccess(path).catch(() => {
      throw error;
    });
    await rm(path, AGENT_FILES_REMOVAL);
  }
}

function isPermissionRefusal(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "EACCES" || error.code === "EPERM");
}

async function grantOwnerFolderAccess(path: string): Promise<void> {
  const entry = await fsPromisesWithoutAsarArchives.lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (!entry?.isDirectory()) return;
  if ((entry.mode & OWNER_FULL_ACCESS) !== OWNER_FULL_ACCESS)
    await fsPromisesWithoutAsarArchives.chmod(path, entry.mode | OWNER_FULL_ACCESS);
  for (const child of await fsPromisesWithoutAsarArchives.readdir(path, { withFileTypes: true }))
    if (child.isDirectory()) await grantOwnerFolderAccess(join(path, child.name));
}

const HELD_COPIED_FOLDER_WAITS_MS: readonly number[] = [10, 50, 100, 250, 500, 1000, 1000, 2000, 2000, 3000];

export class AgentStore {
  readonly #statePath: string;
  readonly #agentsRoot: string;
  readonly #legacyAgentsRoot: string;
  readonly #sharedRoot: string;
  readonly #downloadsRoot: string;
  readonly #avatarsRoot: string;
  readonly channelImagesRoot: string;
  readonly #duplicationsRoot: string;
  readonly #automationRoot: string;
  readonly #profileCreationRecovery: ProfileCreationRecovery;
  readonly #database: OpenBotDatabase;
  #state: StoredState = { version: 2, examplesInitialized: false, agents: [] };
  readonly #avatarUpdateQueue = Semaphore.makeUnsafe(1);
  readonly #creationQueue = Semaphore.makeUnsafe(1);

  readonly #agentDefaults: () => AgentDefaults;

  constructor(
    userDataPath: string,
    homePath: string,
    database: OpenBotDatabase,
    agentDefaults: () => AgentDefaults = () => DEFAULT_AGENT_DEFAULTS,
    openbotRoot = join(homePath, "OpenBot"),
  ) {
    this.#statePath = join(userDataPath, LEGACY_AGENTS_STATE_FILE);
    this.#agentsRoot = join(openbotRoot, "Agents");
    this.#legacyAgentsRoot = join(openbotRoot, "Bots");
    this.#sharedRoot = join(openbotRoot, "Shared");
    this.#downloadsRoot = join(openbotRoot, "Downloads");
    this.#avatarsRoot = join(userDataPath, "avatars", "agents");
    this.channelImagesRoot = join(userDataPath, "avatars", "channels");
    this.#duplicationsRoot = join(userDataPath, "agent-duplications");
    this.#automationRoot = automationRoot(userDataPath);
    this.#database = database;
    this.#agentDefaults = agentDefaults;
    this.#profileCreationRecovery = new ProfileCreationRecovery(
      join(userDataPath, "agent-profile-creations"),
      this.#agentsRoot,
    );
  }

  agentDefaults(): AgentDefaults {
    return this.#agentDefaults();
  }

  get database(): OpenBotDatabase {
    return this.#database;
  }

  get sharedRoot(): string {
    return this.#sharedRoot;
  }

  get downloadsRoot(): string {
    return this.#downloadsRoot;
  }

  get automationRoot(): string {
    return this.#automationRoot;
  }

  initialize = Effect.fn("AgentStore.initialize")(function* (
    this: AgentStore,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      yield* Effect.all(
        [
          storedIO(() => mkdir(this.#agentsRoot, { recursive: true, mode: 0o700 })),
          storedIO(() => mkdir(this.#sharedRoot, { recursive: true, mode: 0o700 })),
          storedIO(() => mkdir(this.#downloadsRoot, { recursive: true, mode: 0o700 })),
          storedIO(() => mkdir(this.#avatarsRoot, { recursive: true, mode: 0o700 })),
          storedIO(() => mkdir(this.#duplicationsRoot, { recursive: true, mode: 0o700 })),
          storedIO(() => mkdir(dirname(this.#statePath), { recursive: true, mode: 0o700 })),
        ],
        { concurrency: "unbounded" },
      );

      yield* this.#database.initialize();
      const persisted = this.#database.listAgents();
      if (persisted.length > 0 || this.#database.hasAggregateEvents("agents", "agents")) {
        const agents: StoredAgent[] = [];
        const repairs: string[] = [];
        for (const stored of persisted) {
          const read = readStoredAgent(stored);
          if ("unreadable" in read) throw new Error(unreadableProfileMessage(read));
          agents.push(normalizeStoredAgent(read.agent));
          if (read.repaired.length > 0) repairs.push(`${read.agent.id}: ${read.repaired.join(", ")}`);
        }
        this.#state = { version: 2, examplesInitialized: true, agents };
        this.#restoreRosterFromEvents();
        if (repairs.length > 0) {
          logger.warn("Stored agent profile fields could not be read and were reset.", toLogValue(repairs));
          this.#persist("agents.repaired");
        }
      } else {
        const legacy = yield* this.#readStateEffect();
        yield* this.#database.backupLegacyFile(this.#statePath);
        const sessions: Array<{ agent: StoredAgent; externalSessionId: string }> = [];
        legacy.agents = legacy.agents.map((agent) => {
          if (!agent.threadId) return agent;
          sessions.push({ agent, externalSessionId: agent.threadId });
          return { ...agent, threadId: stableThreadId(agent.id) };
        });
        legacy.examplesInitialized = true;
        this.#state = legacy;
        this.#database.replaceAgents(LEGACY_AGENTS_IMPORT_COMMAND_ID, legacy.agents, "agents.legacy-imported");
        for (const { agent, externalSessionId } of sessions) {
          const threadId = stableThreadId(agent.id);
          this.#database.bindProviderSession({
            threadId,
            provider: agent.provider,
            externalSessionId,
            model: agent.model,
            effort: agent.reasoningEffort,
          });
          this.#database.deactivateProviderSessions(threadId);
        }
      }
      this.#resetClaudeFastModeOnce();
      yield* this.#reconcileLegacyDirectoriesEffect();
      yield* this.#recoverPendingDuplicationsEffect();
      yield* this.#profileCreationRecovery.recover(this.#database, (agentId) =>
        this.deleteAgent(agentId).pipe(Effect.asVoid),
      );
      this.#reconcileUnclaimedThreads();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  list(): AgentSummary[] {
    return this.#state.agents.map((agent) => ({ ...agent }));
  }

  get(id: string): AgentSummary | undefined {
    const agent = this.#state.agents.find((candidate) => candidate.id === id);
    return agent ? { ...agent } : undefined;
  }

  has(id: string): boolean {
    return this.#state.agents.some((agent) => agent.id === id);
  }

  createAgent(input: Omit<CreateAgentInput, "initialMessage">, profileOperationId?: string) {
    return this.#creationQueue.withPermit(this.#createAgent(input, profileOperationId));
  }

  #createAgent = Effect.fn("AgentStore.createAgent")(function* (
    this: AgentStore,
    input: Omit<CreateAgentInput, "initialMessage">,
    profileOperationId?: string,
  ): Effect.fn.Return<AgentSummary, StoredStateFailure> {
    try {
      if (this.#state.agents.length >= INPUT_LIMITS.agents) {
        throw new Error(sourceText("error.agent.hostLimit", { limit: INPUT_LIMITS.agents }));
      }
      const name = requiredText(input.name, "Agent name", INPUT_LIMITS.agentName);
      const description = limitedText(input.description, "Agent description", INPUT_LIMITS.agentDescription);
      if (!isAvatarSeed(input.avatarSeed)) throw new Error("Invalid avatar seed.");
      if (input.avatarHue !== null && !isAvatarHue(input.avatarHue)) throw new Error("Invalid avatar hue.");
      if (input.avatarColor != null && !isAvatarColor(input.avatarColor)) throw new Error("Invalid avatar color.");
      const record = this.#createRecord(`agent-${randomUUID()}`, name, "", description);
      record.avatarSeed = input.avatarSeed;
      record.avatarHue = input.avatarHue;
      applyAvatarColor(record, input.avatarHue, input.avatarColor);
      if (profileOperationId) yield* this.#profileCreationRecovery.begin(record.id, profileOperationId);
      yield* storedIO(() => mkdir(record.workspacePath, { recursive: true, mode: 0o700 }));
      this.#state.agents.unshift(record);
      try {
        this.#persist("agent.created");
      } catch (error) {
        this.#state.agents = this.#state.agents.filter((candidate) => candidate.id !== record.id);
        yield* storedIO(() => rm(record.workspacePath, { recursive: true, force: true }));
        throw error;
      }
      return { ...record };
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  duplicateAgent(sourceId: string, operationId: string = randomUUID()) {
    return this.#creationQueue.withPermit(this.#duplicateAgent(sourceId, operationId));
  }

  #duplicateAgent = Effect.fn("AgentStore.duplicateAgent")(function* (
    this: AgentStore,
    sourceId: string,
    operationId: string,
  ): Effect.fn.Return<AgentSummary, StoredStateFailure> {
    try {
      if (!isUuidV4(operationId)) throw new Error("Invalid agent duplication operation id.");
      if (this.#database.commandResult(duplicationCommandId(operationId)) !== undefined) {
        throw new Error("This agent duplication operation is already committed.");
      }
      if (this.#state.agents.length >= INPUT_LIMITS.agents) {
        throw new Error(sourceText("error.agent.hostLimit", { limit: INPUT_LIMITS.agents }));
      }
      const source = this.#requireAgent(sourceId);
      const sourceProfileSignature = duplicationProfileSignature(source);
      const sourceWorkspaceManifest = yield* workspaceMetadataFingerprintEffect(source.workspacePath);
      const sourceAvatar = this.resolveAvatar(source.id);
      const sourceAvatarSignature = sourceAvatar ? yield* fileFingerprintEffect(sourceAvatar.path) : null;
      const id = `agent-${randomUUID()}`;
      const record = this.#createRecord(
        id,
        duplicateAgentName(source.name, this.#state.agents),
        source.title,
        source.description,
      );
      record.notifications = source.notifications;
      record.provider = source.provider;
      record.model = source.model;
      record.reasoningEffort = source.reasoningEffort;
      if (source.sessionSettingOverrides)
        record.sessionSettingOverrides = structuredClone(source.sessionSettingOverrides);
      record.access = source.access;
      if (source.additionalFolders) record.additionalFolders = [...source.additionalFolders];
      if (source.excludedFolders)
        record.excludedFolders = source.excludedFolders.map((folder) =>
          isPathInside(source.workspacePath, folder)
            ? join(record.workspacePath, relative(source.workspacePath, folder))
            : folder,
        );
      record.computerUse = source.computerUse;
      if (source.memory === false) record.memory = false;
      if (source.busyMessageMode) record.busyMessageMode = source.busyMessageMode;
      if (source.taskLimit !== undefined) record.taskLimit = source.taskLimit;
      if (source.backupModels) record.backupModels = structuredClone(source.backupModels);
      if (source.browserProfileId !== undefined) {
        record.browserProfileId = source.browserProfileId;
        record.ownBrowserSession = true;
      }
      record.avatarSeed = source.avatarSeed;
      record.avatarHue = source.avatarHue;
      if (source.avatarColor) record.avatarColor = source.avatarColor;
      if (source.chatColor) record.chatColor = source.chatColor;

      const stagedWorkspace = `${record.workspacePath}.openbot-stage`;
      const avatarDirectory = join(this.#avatarsRoot, record.id);
      const stagedAvatarDirectory = `${avatarDirectory}.openbot-stage`;
      const duplicationMarker = this.#duplicationMarkerPath(record.id);
      let stagedAvatarPath: string | null = null;
      const windowsFolderLinks: string[] = [];
      {
        const attempt1 = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            try {
              yield* storedIO(() =>
                writeFile(duplicationMarker, `${JSON.stringify({ operationId, sourceAgentId: sourceId })}\n`, {
                  encoding: "utf8",
                  mode: 0o600,
                  flag: "wx",
                }),
              );
              yield* storedIO(() =>
                cp(source.workspacePath, stagedWorkspace, {
                  recursive: true,
                  dereference: false,
                  errorOnExist: true,
                  force: false,
                  verbatimSymlinks: true,
                  filter: skipFolderLinksOnWindows(source.workspacePath, windowsFolderLinks),
                }),
              );
              if (sourceAvatar) {
                yield* storedIO(() => mkdir(stagedAvatarDirectory, { recursive: true, mode: 0o700 }));
                const extension = avatarFileExtension(sourceAvatar.mimeType);
                const avatarCopy = join(stagedAvatarDirectory, `${sourceAvatar.version}.${extension}`);
                stagedAvatarPath = avatarCopy;
                yield* storedIO(() => copyFile(sourceAvatar.path, avatarCopy));
                record.avatarUrl = agentAvatarUrl(record.id, sourceAvatar.version, sourceAvatar.mimeType);
              }
              if (
                duplicationProfileSignature(source) !== sourceProfileSignature ||
                (yield* workspaceMetadataFingerprintEffect(source.workspacePath)) !== sourceWorkspaceManifest ||
                (stagedAvatarPath ? yield* fileFingerprintEffect(stagedAvatarPath) : null) !== sourceAvatarSignature ||
                (sourceAvatar ? yield* fileFingerprintEffect(sourceAvatar.path) : null) !== sourceAvatarSignature
              ) {
                throw new Error(sourceText("error.agent.changedWhileDuplicating"));
              }
              yield* rewriteInternalWorkspaceSymlinksEffect(
                source.workspacePath,
                stagedWorkspace,
                record.workspacePath,
              );
              yield* copyFolderLinksEffect(
                windowsFolderLinks,
                source.workspacePath,
                stagedWorkspace,
                record.workspacePath,
              );
              if (this.#state.agents.length >= INPUT_LIMITS.agents) {
                throw new Error(sourceText("error.agent.hostLimit", { limit: INPUT_LIMITS.agents }));
              }
              record.name = duplicateAgentName(source.name, this.#state.agents);
              yield* renameCopiedFolderEffect(stagedWorkspace, record.workspacePath);
              if (sourceAvatar) yield* renameCopiedFolderEffect(stagedAvatarDirectory, avatarDirectory);
              this.#state.agents.unshift(record);
              try {
                this.#persist("agent.duplicated");
              } catch (error) {
                this.#state.agents = this.#state.agents.filter((candidate) => candidate.id !== record.id);
                throw error;
              }
              return { ...record };
            } catch (cause) {
              return yield* new StoredStateFailure({ cause });
            }
          }),
        );
        if (Result.isFailure(attempt1)) {
          const error = attempt1.failure.cause;
          yield* Effect.all(
            [
              storedIO(() => rm(stagedWorkspace, { recursive: true, force: true })),
              storedIO(() => rm(record.workspacePath, { recursive: true, force: true })),
              storedIO(() => rm(stagedAvatarDirectory, { recursive: true, force: true })),
              storedIO(() => rm(avatarDirectory, { recursive: true, force: true })),
              storedIO(() => rm(duplicationMarker, { force: true })),
            ],
            { concurrency: "unbounded" },
          );
          throw error;
        } else {
          return attempt1.success;
        }
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  committedAgentDuplication(operationId: string, sourceAgentId: string): DuplicateAgentResult | null {
    if (!isUuidV4(operationId)) throw new Error("Invalid agent duplication operation id.");
    const value = this.#database.commandResult(duplicationCommandId(operationId));
    if (value === undefined) return null;
    const result = isRecord(value) ? value.result : null;
    const resultAgent = isRecord(result) ? (result.agent ?? result.bot) : null;
    const resultLayout = isRecord(result) ? result.layout : null;
    const receiptSourceId = isRecord(value) ? (value.sourceAgentId ?? value.sourceBotId) : null;
    if (
      !isRecord(value) ||
      receiptSourceId !== sourceAgentId ||
      !isRecord(result) ||
      !isStoredAgent(resultAgent) ||
      !isSidebarLayoutSnapshot(resultLayout)
    ) {
      throw new Error("The agent duplication receipt is invalid.");
    }
    const agent = this.#state.agents.find((candidate) => candidate.id === resultAgent.id);
    if (!agent) throw new Error(sourceText("error.agent.duplicatedAgentGone"));
    return {
      agent: { ...agent },
      layout: structuredClone(resultLayout),
    };
  }

  commitAgentDuplication = Effect.fn("AgentStore.commitAgentDuplication")(function* (
    this: AgentStore,
    id: string,
    operationId: string,
    sourceAgentId: string,
    layout: SidebarLayoutSnapshot,
  ): Effect.fn.Return<DuplicateAgentResult, StoredStateFailure> {
    try {
      const agent = this.#requireAgent(id);
      const marker = yield* this.#readDuplicationMarkerEffect(id);
      if (!marker || marker.operationId !== operationId || marker.sourceAgentId !== sourceAgentId) {
        throw new Error("This agent duplication marker is invalid.");
      }
      const result = { agent: { ...agent }, layout: structuredClone(layout) };
      const receipt = this.#database.dispatch(
        duplicationCommandId(operationId),
        [
          {
            aggregateType: "agent-duplications",
            aggregateId: id,
            eventType: "agent-duplication.committed",
            payload: { sourceAgentId, duplicateAgentId: id },
          },
        ],
        () => ({ sourceAgentId, result }),
      );
      yield* storedIO(() => rm(this.#duplicationMarkerPath(id), { force: true }).catch(() => undefined));
      if (
        !isRecord(receipt) ||
        !isRecord(receipt.result) ||
        !isStoredAgent(receipt.result.agent) ||
        !isSidebarLayoutSnapshot(receipt.result.layout)
      ) {
        throw new Error("The agent duplication receipt is invalid.");
      }
      return {
        agent: { ...normalizeStoredAgent(receipt.result.agent) },
        layout: structuredClone(receipt.result.layout),
      };
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  saveReviewedProfile(agentId: string, draft: AgentProfileDraft): AgentSummary {
    draft = decodeAgentProfileDraft(draft);
    const agent = this.#requireAgent(agentId);
    const previous = { ...agent };
    Object.assign(agent, {
      name: draft.name,
      title: draft.title,
      description: draft.description,
      avatarSeed: draft.avatarSeed,
      avatarHue: draft.avatarHue,
      avatarUrl: null,
      updatedAt: new Date().toISOString(),
    });
    if (draft.avatarHue !== previous.avatarHue) delete agent.avatarColor;
    try {
      this.#persist("agent.updated");
    } catch (error) {
      Object.assign(agent, previous);
      throw error;
    }
    return { ...agent };
  }

  commitReviewedProfile(
    agentId: string,
    draft: AgentProfileDraft,
    commandId: string,
    layout: SidebarLayoutSnapshot,
  ): SaveAgentProfileResult {
    const previous = { ...this.#requireAgent(agentId) };
    try {
      const result = this.#database.dispatch(
        commandId,
        [
          {
            aggregateType: "agent-profiles",
            aggregateId: agentId,
            eventType: "agent-profile.saved",
            payload: { agentId },
          },
        ],
        () => {
          const agent = this.saveReviewedProfile(agentId, draft);
          return { agent, layout };
        },
      );
      return decodeSaveAgentProfileResult(result);
    } catch (error) {
      Object.assign(this.#requireAgent(agentId), previous);
      throw error;
    }
  }

  setSessionSettingOverrides(
    agentId: string,
    overrides: AgentSessionSettingOverrides,
    resetIdentity?: string,
  ): AgentSummary {
    if (!isAgentSessionSettingOverrides(overrides)) throw new Error(sourceText("error.provider.sessionSettingInvalid"));
    const agent = this.#requireAgent(agentId);
    const previous = agent.sessionSettingOverrides;
    const previousResets = agent.sessionSettingResets;
    if (resetIdentity) agent.sessionSettingResets = [...new Set([...(previousResets ?? []), resetIdentity])];
    agent.sessionSettingOverrides = structuredClone(overrides);
    try {
      this.#persist("agent.updated");
    } catch (error) {
      if (previous === undefined) delete agent.sessionSettingOverrides;
      else agent.sessionSettingOverrides = previous;
      if (previousResets === undefined) delete agent.sessionSettingResets;
      else agent.sessionSettingResets = previousResets;
      throw error;
    }
    return { ...agent };
  }

  clearSessionSettingReset(agentId: string, identity: string): void {
    const agent = this.#requireAgent(agentId);
    const previous = agent.sessionSettingResets;
    if (!previous?.includes(identity)) return;
    agent.sessionSettingResets = previous.filter((value) => value !== identity);
    try {
      this.#persist("agent.updated");
    } catch (error) {
      agent.sessionSettingResets = previous;
      throw error;
    }
  }

  updateAgent = Effect.fn("AgentStore.updateAgent")(function* (
    this: AgentStore,
    input: UpdateAgentInput & {
      usageLimitReturn?: AgentUsageLimitReturn | null;
      pendingRuntime?: AgentPendingRuntime | null;
      pinnedAccountId?: string | null;
      ownBrowserSession?: boolean;
      browserProfileId?: string | null;
      additionalFolders?: string[];
      excludedFolders?: string[];
    },
    initiatingAgentId?: string,
  ): Effect.fn.Return<AgentSummary, StoredStateFailure> {
    try {
      const agent = this.#requireAgent(input.agentId);
      const next = { ...agent };
      if (input.name !== undefined) {
        next.name = requiredText(input.name, "Agent name", INPUT_LIMITS.agentName);
      }
      if (input.title !== undefined) {
        next.title = limitedText(input.title, "Agent title", INPUT_LIMITS.agentTitle);
      }
      if (input.description !== undefined) {
        next.description = limitedText(input.description, "Agent description", INPUT_LIMITS.agentDescription);
      }
      if (input.notifications !== undefined) next.notifications = input.notifications;
      if (input.provider !== undefined) {
        if (!isOneOf(AGENT_PROVIDERS, input.provider)) throw new Error("Invalid agent provider.");
        next.provider = input.provider;
      }
      if (input.model !== undefined) {
        if (!isAgentModel(input.model)) throw new Error("Invalid agent model.");
        next.model = input.model;
      }
      if (input.reasoningEffort !== undefined) {
        if (!isReasoningEffort(input.reasoningEffort)) throw new Error("Invalid reasoning effort.");
        next.reasoningEffort = input.reasoningEffort;
      }
      if (input.access !== undefined) {
        if (!isAgentAccess(input.access)) throw new Error("Invalid agent access.");
        next.access = input.access;
      }
      if (input.additionalFolders !== undefined) {
        if (!isAgentAdditionalFolders(input.additionalFolders)) throw new Error("Invalid agent folders.");
        if (input.additionalFolders.length === 0) delete next.additionalFolders;
        else next.additionalFolders = [...input.additionalFolders];
      }
      if (input.excludedFolders !== undefined) {
        if (!isAgentAdditionalFolders(input.excludedFolders)) throw new Error("Invalid agent folders.");
        if (input.excludedFolders.length === 0) delete next.excludedFolders;
        else next.excludedFolders = [...input.excludedFolders];
      }
      if (input.computerUse !== undefined) {
        if (!isBoolean(input.computerUse)) throw new Error("Invalid Computer Use value.");
        next.computerUse = input.computerUse;
      }
      if (input.allowAutomation === null) delete next.allowAutomation;
      else if (input.allowAutomation !== undefined) {
        if (!isBoolean(input.allowAutomation)) throw new Error("Invalid automation value.");
        next.allowAutomation = input.allowAutomation;
      }
      if (input.allowNewChat === null) delete next.allowNewChat;
      else if (input.allowNewChat !== undefined) {
        if (!isBoolean(input.allowNewChat)) throw new Error("Invalid new chat value.");
        next.allowNewChat = input.allowNewChat;
      }
      if (input.memory !== undefined) {
        if (!isBoolean(input.memory)) throw new Error("Invalid memory value.");
        if (input.memory) delete next.memory;
        else next.memory = false;
      }
      if (input.quickAcknowledgement === null) delete next.quickAcknowledgement;
      else if (input.quickAcknowledgement !== undefined) {
        if (!isBoolean(input.quickAcknowledgement)) throw new Error("Invalid quick acknowledgement value.");
        next.quickAcknowledgement = input.quickAcknowledgement;
      }
      if (input.ownBrowserSession !== undefined) {
        if (!isBoolean(input.ownBrowserSession)) throw new Error("Invalid browser session value.");
        next.ownBrowserSession = input.ownBrowserSession;
        delete next.browserProfileId;
      }
      if (input.browserProfileId === null) delete next.browserProfileId;
      else if (input.browserProfileId !== undefined) {
        if (!isBrowserProfileId(input.browserProfileId)) throw new Error("Invalid browser profile.");
        next.browserProfileId = input.browserProfileId;
        next.ownBrowserSession = true;
      }
      if (input.fastMode !== undefined) {
        if (!isBoolean(input.fastMode)) throw new Error("Invalid fast mode value.");
        next.fastMode = input.fastMode;
      } else if (input.provider !== undefined && input.provider !== agent.provider && next.fastMode) {
        next.fastMode = false;
      }
      if (input.ultrafast !== undefined && (!isBoolean(input.ultrafast) || input.fastMode === undefined))
        throw new Error("Invalid fast mode value.");
      if (input.fastMode !== undefined) {
        if (input.fastMode && input.ultrafast) next.ultrafast = true;
        else delete next.ultrafast;
      }
      if (!next.fastMode) delete next.ultrafast;
      if (
        input.providerAccountId === null ||
        input.providerAccountId === DEFAULT_PROVIDER_ACCOUNT_ID ||
        (input.provider !== undefined && input.provider !== agent.provider && input.providerAccountId === undefined)
      )
        delete next.providerAccountId;
      else if (input.providerAccountId !== undefined) {
        if (!isProviderAccountId(input.providerAccountId)) throw new Error("Invalid provider account.");
        next.providerAccountId = input.providerAccountId;
      }
      if (input.busyMessageMode === null) delete next.busyMessageMode;
      else if (input.busyMessageMode !== undefined) {
        if (!isBusyMessageMode(input.busyMessageMode)) throw new Error("Invalid busy message mode.");
        next.busyMessageMode = input.busyMessageMode;
      }
      if (input.taskLimit === null) delete next.taskLimit;
      else if (input.taskLimit !== undefined) {
        if (!isAgentTaskLimit(input.taskLimit)) throw new Error("Invalid task limit.");
        next.taskLimit = input.taskLimit;
      }
      if (input.backupModels === null) delete next.backupModels;
      else if (input.backupModels !== undefined) {
        if (!isAgentBackupModels(input.backupModels)) throw new Error("Invalid backup models.");
        next.backupModels = structuredClone(input.backupModels);
      }
      if (input.avatarSeed !== undefined) {
        if (!isAvatarSeed(input.avatarSeed)) throw new Error("Invalid avatar seed.");
        next.avatarSeed = input.avatarSeed;
      }
      if (input.avatarHue !== undefined && input.avatarHue !== null && !isAvatarHue(input.avatarHue)) {
        throw new Error("Invalid avatar hue.");
      }
      if (input.avatarColor != null && !isAvatarColor(input.avatarColor)) throw new Error("Invalid avatar color.");
      if (input.avatarHue !== undefined || input.avatarColor !== undefined) {
        const hue = input.avatarHue === undefined ? next.avatarHue : input.avatarHue;
        applyAvatarColor(next, hue, input.avatarColor, hue !== next.avatarHue);
      }
      if (input.chatColor === null) delete next.chatColor;
      else if (input.chatColor !== undefined) {
        if (!isAvatarColor(input.chatColor)) throw new Error("Invalid chat color.");
        next.chatColor = input.chatColor;
      }
      if (
        input.usageLimitReturn === null ||
        (input.usageLimitReturn === undefined &&
          (next.provider !== agent.provider ||
            next.model !== agent.model ||
            next.providerAccountId !== agent.providerAccountId))
      )
        delete next.usageLimitReturn;
      else if (input.usageLimitReturn !== undefined) {
        if (!isAgentUsageLimitReturn(input.usageLimitReturn)) throw new Error("Invalid usage limit model.");
        next.usageLimitReturn = { ...input.usageLimitReturn };
      }
      if (input.pendingRuntime === null) delete next.pendingRuntime;
      else if (input.pendingRuntime !== undefined) {
        if (!isAgentPendingRuntime(input.pendingRuntime)) throw new Error("Invalid pending runtime.");
        next.pendingRuntime = { ...input.pendingRuntime };
      } else if (next.provider !== agent.provider || next.providerAccountId !== agent.providerAccountId) {
        delete next.pendingRuntime;
      }
      if (input.pinnedAccountId === null) delete next.pinnedAccountId;
      else if (input.pinnedAccountId !== undefined) {
        if (!isProviderAccountId(input.pinnedAccountId)) throw new Error("Invalid pinned account.");
        next.pinnedAccountId = input.pinnedAccountId;
      } else if (
        (next.provider !== agent.provider || next.providerAccountId !== agent.providerAccountId) &&
        (next.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID) !== next.pinnedAccountId
      ) {
        delete next.pinnedAccountId;
      }
      next.updatedAt = new Date().toISOString();
      const previous = { ...agent };
      const modelChanged =
        next.provider !== agent.provider ||
        next.model !== agent.model ||
        next.reasoningEffort !== agent.reasoningEffort;
      const modelChange: AgentModelChange | undefined =
        initiatingAgentId !== undefined && modelChanged
          ? {
              initiatingAgentId,
              targetAgentId: agent.id,
              previous: { provider: agent.provider, model: agent.model, reasoningEffort: agent.reasoningEffort },
              next: { provider: next.provider, model: next.model, reasoningEffort: next.reasoningEffort },
            }
          : undefined;
      Object.assign(agent, next);
      if (next.busyMessageMode === undefined) delete agent.busyMessageMode;
      if (next.taskLimit === undefined) delete agent.taskLimit;
      if (next.providerAccountId === undefined) delete agent.providerAccountId;
      if (next.backupModels === undefined) delete agent.backupModels;
      if (next.additionalFolders === undefined) delete agent.additionalFolders;
      if (next.excludedFolders === undefined) delete agent.excludedFolders;
      if (next.usageLimitReturn === undefined) delete agent.usageLimitReturn;
      if (next.pendingRuntime === undefined) delete agent.pendingRuntime;
      if (next.pinnedAccountId === undefined) delete agent.pinnedAccountId;
      if (next.browserProfileId === undefined) delete agent.browserProfileId;
      if (next.allowAutomation === undefined) delete agent.allowAutomation;
      if (next.allowNewChat === undefined) delete agent.allowNewChat;
      if (next.quickAcknowledgement === undefined) delete agent.quickAcknowledgement;
      if (next.memory === undefined) delete agent.memory;
      if (next.ultrafast === undefined) delete agent.ultrafast;
      if (next.avatarColor === undefined) delete agent.avatarColor;
      if (next.chatColor === undefined) delete agent.chatColor;
      try {
        this.#persist(modelChange ? "agent.model-changed" : "agent.updated", modelChange);
      } catch (error) {
        Object.assign(agent, previous);
        if (previous.busyMessageMode === undefined) delete agent.busyMessageMode;
        if (previous.taskLimit === undefined) delete agent.taskLimit;
        if (previous.providerAccountId === undefined) delete agent.providerAccountId;
        if (previous.backupModels === undefined) delete agent.backupModels;
        if (previous.additionalFolders === undefined) delete agent.additionalFolders;
        if (previous.excludedFolders === undefined) delete agent.excludedFolders;
        if (previous.usageLimitReturn === undefined) delete agent.usageLimitReturn;
        if (previous.pendingRuntime === undefined) delete agent.pendingRuntime;
        if (previous.pinnedAccountId === undefined) delete agent.pinnedAccountId;
        if (previous.browserProfileId === undefined) delete agent.browserProfileId;
        if (previous.allowAutomation === undefined) delete agent.allowAutomation;
        if (previous.allowNewChat === undefined) delete agent.allowNewChat;
        if (previous.quickAcknowledgement === undefined) delete agent.quickAcknowledgement;
        if (previous.memory === undefined) delete agent.memory;
        if (previous.ultrafast === undefined) delete agent.ultrafast;
        if (previous.avatarColor === undefined) delete agent.avatarColor;
        if (previous.chatColor === undefined) delete agent.chatColor;
        throw error;
      }
      return { ...agent };
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  setHidden(agentId: string, hiddenAt: string | null): AgentSummary {
    const agent = this.#requireAgent(agentId);
    const previous = agent.hiddenAt;
    if ((hiddenAt === null && previous === undefined) || (hiddenAt !== null && previous !== undefined))
      return { ...agent };
    if (hiddenAt !== null && !isHiddenAt(hiddenAt)) throw new Error("Invalid hidden agent time.");
    if (hiddenAt === null) delete agent.hiddenAt;
    else agent.hiddenAt = hiddenAt;
    try {
      this.#persist(hiddenAt === null ? "agent.restored" : "agent.hidden");
    } catch (error) {
      if (previous === undefined) delete agent.hiddenAt;
      else agent.hiddenAt = previous;
      throw error;
    }
    return { ...agent };
  }

  isHidden(agentId: string): boolean {
    return this.#state.agents.some((agent) => agent.id === agentId && agent.hiddenAt !== undefined);
  }

  setMarketplaceSource(agentId: string, source: NonNullable<AgentSummary["marketplaceSource"]>): AgentSummary {
    const agent = this.#requireAgent(agentId);
    agent.marketplaceSource = structuredClone(source);
    agent.updatedAt = new Date().toISOString();
    this.#persist("agent.marketplace-source-updated");
    return { ...agent, marketplaceSource: structuredClone(source) };
  }

  setAvatar(agentId: string, image: AvatarImageInput | null) {
    return this.#avatarUpdateQueue.withPermit(this.#setAvatar(agentId, image));
  }

  #setAvatar = Effect.fn("AgentStore.setAvatar")(function* (
    this: AgentStore,
    agentId: string,
    image: AvatarImageInput | null,
  ): Effect.fn.Return<AgentSummary, StoredStateFailure> {
    try {
      const agent = this.#requireAgent(agentId);
      const previous = this.resolveAvatar(agentId);
      const previousAvatarUrl = agent.avatarUrl;
      const previousUpdatedAt = agent.updatedAt;
      if (image === null) {
        agent.avatarUrl = null;
        agent.updatedAt = new Date().toISOString();
        try {
          this.#persist("agent.avatar-removed");
        } catch (error) {
          agent.avatarUrl = previousAvatarUrl;
          agent.updatedAt = previousUpdatedAt;
          throw error;
        }
        if (previous) yield* storedIO(() => rm(previous.path, { force: true }).catch(() => undefined));
        return { ...agent };
      }
      if (!isValidAvatarImage(image.mimeType, image.bytes)) {
        throw new Error(sourceText("error.team.logoInvalid"));
      }
      const version = randomUUID();
      const extension = avatarFileExtension(image.mimeType);
      const directory = join(this.#avatarsRoot, agent.id);
      const target = join(directory, `${version}.${extension}`);
      yield* storedIO(() => mkdir(directory, { recursive: true, mode: 0o700 }));
      yield* writeFileAtomically(target, image.bytes).pipe(
        Effect.mapError(({ cause }) => new StoredStateFailure({ cause })),
      );
      agent.avatarUrl = agentAvatarUrl(agent.id, version, image.mimeType);
      agent.updatedAt = new Date().toISOString();
      try {
        this.#persist("agent.avatar-updated");
      } catch (error) {
        agent.avatarUrl = previousAvatarUrl;
        agent.updatedAt = previousUpdatedAt;
        yield* storedIO(() => rm(target, { force: true }));
        throw error;
      }
      if (previous) yield* storedIO(() => rm(previous.path, { force: true }).catch(() => undefined));
      return { ...agent };
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"]; version: string } | null {
    const agent = this.#requireAgent(agentId);
    if (!agent.avatarUrl) return null;
    const parsed = parseAgentAvatarUrl(agent.avatarUrl, agent.id);
    if (!parsed) return null;
    const extension = avatarFileExtension(parsed.mimeType);
    return {
      path: join(this.#avatarsRoot, agent.id, `${parsed.version}.${extension}`),
      mimeType: parsed.mimeType,
      version: parsed.version,
    };
  }

  deleteAgent = Effect.fn("AgentStore.deleteAgent")(function* (
    this: AgentStore,
    id: string,
  ): Effect.fn.Return<AgentSummary | null, StoredStateFailure> {
    try {
      validateAgentId(id);
      const agent = this.#state.agents.find((candidate) => candidate.id === id);
      for (const path of [
        join(this.#avatarsRoot, id),
        `${join(this.#avatarsRoot, id)}.openbot-stage`,
        join(this.#agentsRoot, id),
        `${join(this.#agentsRoot, id)}.openbot-stage`,
      ]) {
        yield* storedIO(() => removeAgentFiles(path));
      }
      yield* storedIO(() => rm(this.#duplicationMarkerPath(id), { force: true }));
      const legacyPaths = [join(this.#legacyAgentsRoot, id)];
      const legacyId = this.#unclaimedLegacyId(id);
      if (legacyId !== null) {
        legacyPaths.push(join(this.#avatarsRoot, legacyId), join(this.#legacyAgentsRoot, legacyId));
      }
      for (const path of legacyPaths) yield* storedIO(() => removeAgentFiles(path));
      const remaining = this.#state.agents.filter((candidate) => candidate.id !== id);
      this.#database.hardDeleteAgent(`agents:hard-delete:${randomUUID()}`, id, agent?.threadId ?? null, remaining);
      this.#state.agents = remaining;
      return agent ? { ...agent } : null;
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  existing = Effect.fn("AgentStore.existing")(function* (
    this: AgentStore,
    id: string,
  ): Effect.fn.Return<AgentSummary, StoredStateFailure> {
    const agent = yield* storedSync(() => this.#requireAgent(id));
    yield* storedIO(() => mkdir(agent.workspacePath, { recursive: true, mode: 0o700 }));
    return { ...agent };
  }).bind(this);

  getOrCreate = Effect.fn("AgentStore.getOrCreate")(function* (
    this: AgentStore,
    id: string,
    name?: string,
    title?: string,
  ): Effect.fn.Return<AgentSummary, StoredStateFailure> {
    yield* storedSync(() => validateAgentId(id));
    const existing = this.#state.agents.find((agent) => agent.id === id);
    if (existing) {
      yield* storedIO(() => mkdir(existing.workspacePath, { recursive: true, mode: 0o700 }));
      return { ...existing };
    }
    return yield* this.#creationQueue.withPermit(this.#getOrCreate(id, name, title));
  }).bind(this);

  #getOrCreate = Effect.fn("AgentStore.getOrCreate")(function* (
    this: AgentStore,
    id: string,
    name?: string,
    title?: string,
  ): Effect.fn.Return<AgentSummary, StoredStateFailure> {
    try {
      validateAgentId(id);
      const existing = this.#state.agents.find((agent) => agent.id === id);
      if (existing) {
        yield* storedIO(() => mkdir(existing.workspacePath, { recursive: true, mode: 0o700 }));
        return { ...existing };
      }
      if (this.#state.agents.length >= INPUT_LIMITS.agents) {
        throw new Error(sourceText("error.agent.hostLimit", { limit: INPUT_LIMITS.agents }));
      }

      const record = this.#createRecord(id, name ?? titleFromId(id), title ?? "Local teammate");
      this.#state.agents.push(record);
      yield* storedIO(() => mkdir(record.workspacePath, { recursive: true, mode: 0o700 }));
      this.#persist("agent.created");
      return { ...record };
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #reconcileLegacyDirectoriesEffect = Effect.fn("AgentStore.reconcileLegacyDirectories")(function* (
    this: AgentStore,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      let relocated = false;
      for (const agent of this.#state.agents) {
        relocated = (yield* this.#reconcileWorkspaceDirectoryEffect(agent)) || relocated;
        relocated = (yield* this.#rebaseForeignWorkspaceEffect(agent)) || relocated;
        yield* this.#reconcileAvatarDirectoryEffect(agent);
      }
      if (relocated) this.#persist("agent.workspace-relocated");
      yield* this.#removeLegacyWorkspaceRootEffect();
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #unclaimedLegacyId(id: string): string | null {
    const legacyId = legacyAgentId(id);
    if (legacyId === id) return id;
    return this.#state.agents.some((candidate) => candidate.id === legacyId) ? null : legacyId;
  }

  #reconcileWorkspaceDirectoryEffect = Effect.fn("AgentStore.reconcileWorkspaceDirectory")(function* (
    this: AgentStore,
    agent: StoredAgent,
  ): Effect.fn.Return<boolean, StoredStateFailure> {
    try {
      const legacyId = this.#unclaimedLegacyId(agent.id);
      if (legacyId === null) return false;
      const targetPath = join(this.#agentsRoot, agent.id);
      const legacyPath = join(this.#legacyAgentsRoot, legacyId);
      if (legacyPath === targetPath) return false;
      const current = yield* probeDirectoryEffect(targetPath);
      const legacy = yield* probeDirectoryEffect(legacyPath);
      if (current !== false || legacy !== true) {
        if (current === true && legacy === false && agent.workspacePath !== targetPath) {
          agent.workspacePath = targetPath;
          return true;
        }
        return false;
      }
      {
        const attempt2 = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            try {
              yield* storedIO(() => rename(legacyPath, targetPath));
              if (agent.workspacePath === targetPath) return false;
              agent.workspacePath = targetPath;
              return true;
            } catch (cause) {
              return yield* new StoredStateFailure({ cause });
            }
          }),
        );
        if (Result.isFailure(attempt2)) {
          const error = attempt2.failure.cause;
          logger.warn("Could not move an agent workspace to its new directory.", toLogValue(error));
          if (agent.workspacePath === legacyPath) return false;
          agent.workspacePath = legacyPath;
          return true;
        } else {
          return attempt2.success;
        }
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #rebaseForeignWorkspaceEffect = Effect.fn("AgentStore.rebaseForeignWorkspace")(function* (
    this: AgentStore,
    agent: StoredAgent,
  ): Effect.fn.Return<boolean> {
    const stored = agent.workspacePath;
    if (!isApplicationWorkspacePath(stored, agent.id) || isPathInside(dirname(this.#agentsRoot), stored)) return false;
    const probe = yield* Effect.result(storedIO(() => lstat(stored)));
    if (Result.isSuccess(probe) || !isRecord(probe.failure.cause) || probe.failure.cause.code !== "ENOENT") {
      return false;
    }
    const targetPath = join(this.#agentsRoot, agent.id);
    const created = yield* Effect.result(storedIO(() => mkdir(targetPath, { recursive: true, mode: 0o700 })));
    if (Result.isFailure(created)) {
      logger.warn(
        "Could not create the workspace of an agent from another computer.",
        toLogValue(created.failure.cause),
      );
    }
    logger.warn("An agent workspace path from another computer was changed to this computer.");
    if (agent.excludedFolders)
      agent.excludedFolders = agent.excludedFolders.map((folder) => rebasedFolder(folder, stored, targetPath));
    agent.workspacePath = targetPath;
    return true;
  });

  #reconcileAvatarDirectoryEffect = Effect.fn("AgentStore.reconcileAvatarDirectory")(function* (
    this: AgentStore,
    agent: StoredAgent,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const legacyId = this.#unclaimedLegacyId(agent.id);
      if (legacyId === null || legacyId === agent.id) return;
      const currentPath = join(this.#avatarsRoot, agent.id);
      const legacyPath = join(this.#avatarsRoot, legacyId);
      if ((yield* probeDirectoryEffect(legacyPath)) !== true) return;
      const current = yield* probeDirectoryEffect(currentPath);
      if (current === true) {
        yield* this.#adoptLegacyAvatarFileEffect(agent, legacyPath, currentPath);
        return;
      }
      if (current !== false) return;
      {
        const attempt3 = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            try {
              yield* storedIO(() => rename(legacyPath, currentPath));
            } catch (cause) {
              return yield* new StoredStateFailure({ cause });
            }
          }),
        );
        if (Result.isFailure(attempt3)) {
          const error = attempt3.failure.cause;
          logger.warn("Could not move an uploaded agent avatar to its new directory.", toLogValue(error));
        }
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #adoptLegacyAvatarFileEffect = Effect.fn("AgentStore.adoptLegacyAvatarFile")(function* (
    this: AgentStore,
    agent: StoredAgent,
    legacyPath: string,
    currentPath: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      if (!agent.avatarUrl) return;
      const parsed = parseAgentAvatarUrl(agent.avatarUrl, agent.id);
      if (!parsed) return;
      const name = `${parsed.version}.${avatarFileExtension(parsed.mimeType)}`;
      {
        const attempt4 = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            try {
              if (yield* fileExistsEffect(join(currentPath, name))) return;
              yield* storedIO(() => rename(join(legacyPath, name), join(currentPath, name)));
            } catch (cause) {
              return yield* new StoredStateFailure({ cause });
            }
          }),
        );
        if (Result.isFailure(attempt4)) {
          const error = attempt4.failure.cause;
          logger.warn("Could not move an uploaded agent avatar to its new directory.", toLogValue(error));
        } else {
          return attempt4.success;
        }
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #removeLegacyWorkspaceRootEffect = Effect.fn("AgentStore.removeLegacyWorkspaceRoot")(function* (this: AgentStore) {
    const listing = yield* Effect.result(storedIO(() => readdir(this.#legacyAgentsRoot)));
    if (Result.isFailure(listing)) {
      const error = listing.failure.cause;
      if (!isRecord(error) || error.code !== "ENOENT")
        logger.warn("Could not read the legacy workspace root.", toLogValue(error));
      return;
    }
    const entries = listing.success;
    yield* Effect.forEach(
      entries.filter((entry) => entry.endsWith(".openbot-stage")),
      (entry) =>
        storedIO(() => rm(join(this.#legacyAgentsRoot, entry), { recursive: true, force: true })).pipe(
          Effect.catch(({ cause }) =>
            Effect.sync(() =>
              logger.warn("Could not remove an unfinished copy under the legacy workspace root.", toLogValue(cause)),
            ),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    );
    if (!entries.every((entry) => entry.endsWith(".openbot-stage"))) return;
    yield* storedIO(() => rmdir(this.#legacyAgentsRoot)).pipe(
      Effect.catch(({ cause }) =>
        Effect.sync(() => logger.warn("Could not remove the legacy workspace root.", toLogValue(cause))),
      ),
    );
  });

  #recoverPendingDuplicationsEffect = Effect.fn("AgentStore.recoverPendingDuplications")(function* (
    this: AgentStore,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const entries = yield* storedIO(() => readdir(this.#duplicationsRoot, { withFileTypes: true }));
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".pending")) continue;
        const id = entry.name.slice(0, -".pending".length);
        if (!isGeneratedAgentId(id)) continue;
        const agent = this.#agentByEitherSpelling(id);
        const marker = yield* this.#readDuplicationMarkerEffect(id);
        const agentId = agent?.id ?? id;
        if (agent && marker) {
          const committed = this.committedAgentDuplication(marker.operationId, marker.sourceAgentId);
          if (committed?.agent.id === agentId) {
            yield* storedIO(() => rm(join(this.#duplicationsRoot, entry.name), { force: true }));
            continue;
          }
        }
        if (agent) {
          this.#state.agents = this.#state.agents.filter((candidate) => candidate.id !== agentId);
          this.#database.hardDeleteAgent(
            `agents:duplicate-recovery:${randomUUID()}`,
            agentId,
            agent.threadId,
            this.#state.agents,
          );
        }
        const names = agentId === id ? [id] : [id, agentId];
        const roots = [this.#agentsRoot, this.#legacyAgentsRoot, this.#avatarsRoot];
        yield* Effect.all(
          [
            ...roots.flatMap((root) =>
              names.flatMap((name) => [
                storedIO(() => rm(join(root, name), { recursive: true, force: true })),
                storedIO(() => rm(`${join(root, name)}.openbot-stage`, { recursive: true, force: true })),
              ]),
            ),
            storedIO(() => rm(join(this.#duplicationsRoot, entry.name), { force: true })),
          ],
          { concurrency: "unbounded" },
        );
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #reconcileUnclaimedThreads(): void {
    const unclaimed = this.#database.unclaimedThreads();
    if (unclaimed.length === 0) return;
    let adopted = 0;
    for (const thread of unclaimed) {
      const agent = this.#agentByEitherSpelling(thread.agentId);
      if (!agent || agent.threadId) continue;
      agent.threadId = thread.threadId;
      adopted += 1;
    }
    if (adopted > 0) this.#persist("thread.reclaimed");
    const stranded = unclaimed.length - adopted;
    if (stranded > 0) logger.warn("Threads remain that no agent claims.", stranded);
  }

  #agentByEitherSpelling(id: string): StoredAgent | undefined {
    return (
      this.#state.agents.find((candidate) => candidate.id === id) ??
      this.#state.agents.find((candidate) => legacyAgentId(candidate.id) === id)
    );
  }

  #duplicationMarkerPath(id: string): string {
    return join(this.#duplicationsRoot, `${id}.pending`);
  }

  #readDuplicationMarkerEffect = Effect.fn("AgentStore.readDuplicationMarker")(function* (
    this: AgentStore,
    id: string,
  ): Effect.fn.Return<AgentDuplicationMarker | null, StoredStateFailure> {
    try {
      {
        const attempt7 = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            try {
              const value = JSON.parse(yield* storedIO(() => readFile(this.#duplicationMarkerPath(id), "utf8")));
              const storedSource = isRecord(value) ? (value.sourceAgentId ?? value.sourceBotId) : null;
              if (
                !isRecord(value) ||
                !isString(value.operationId) ||
                !isUuidV4(value.operationId) ||
                !isString(storedSource) ||
                !storedSource
              ) {
                return null;
              }
              const sourceAgentId = this.#agentByEitherSpelling(storedSource)?.id ?? storedSource;
              return { operationId: value.operationId, sourceAgentId };
            } catch (cause) {
              return yield* new StoredStateFailure({ cause });
            }
          }),
        );
        if (Result.isFailure(attempt7)) {
          return null;
        } else {
          return attempt7.success;
        }
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  ensureThreadId = Effect.fn("AgentStore.ensureThreadId")(function* (
    this: AgentStore,
    id: string,
  ): Effect.fn.Return<string, StoredStateFailure> {
    try {
      return this.ensureThreadIdNow(id);
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  ensureThreadIdNow(id: string): string {
    const agent = this.#requireAgent(id);
    if (agent.threadId) return agent.threadId;
    agent.threadId = stableThreadId(id);
    agent.updatedAt = new Date().toISOString();
    this.#persist("thread.created");
    return agent.threadId;
  }

  restoreThreadIdentity(id: string, threadId: string | null, updatedAt: string | null): void {
    const agent = this.#requireAgent(id);
    agent.threadId = threadId;
    agent.updatedAt = updatedAt;
  }

  providerOf(id: string): AgentProviderId | undefined {
    return this.#state.agents.find((agent) => agent.id === id)?.provider;
  }

  ownsThread(threadId: string): boolean {
    return this.#state.agents.some((agent) => agent.threadId === threadId);
  }

  mainThreadAgentId(threadId: string): string | null {
    return this.#state.agents.find((agent) => agent.threadId === threadId)?.id ?? null;
  }

  activeProviderSession(id: string): ProviderSession | null {
    const agent = this.#requireAgent(id);
    if (!agent.threadId) return null;
    return this.#database.activeProviderSession(agent.threadId, agent.provider);
  }

  bindProviderSession(id: string, provider: AgentProviderId, externalSessionId: string): ProviderSession {
    const agent = this.#requireAgent(id);
    if (!agent.threadId) throw new Error(`Agent ${id} does not have an OpenBot thread.`);
    return this.#database.bindProviderSession({
      threadId: agent.threadId,
      provider,
      externalSessionId,
      model: agent.model,
      effort: agent.reasoningEffort,
    });
  }

  updatePreview = Effect.fn("AgentStore.updatePreview")(function* (
    this: AgentStore,
    id: string,
    preview: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      const agent = this.#requireAgent(id);
      agent.preview = preview.slice(0, AGENT_PREVIEW_MAX_LENGTH);
      agent.updatedAt = new Date().toISOString();
      this.#persist("agent.preview-updated");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  clearPreview = Effect.fn("AgentStore.clearPreview")(function* (
    this: AgentStore,
    id: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    try {
      this.#requireAgent(id).preview = "";
      this.#persist("agent.preview-updated");
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible).bind(this);

  #readStateEffect = Effect.fn("AgentStore.readState")(function* (
    this: AgentStore,
  ): Effect.fn.Return<StoredState, StoredStateFailure> {
    try {
      {
        const attempt8 = yield* Effect.result(
          Effect.gen({ self: this }, function* () {
            try {
              const contents = yield* storedIO(() => readFile(this.#statePath, "utf8"));
              if (isEmptyStoredFile(contents)) {
                const empty: StoredState = { version: 2, examplesInitialized: false, agents: [] };
                return empty;
              }
              const parsed = parseStoredJson(this.#statePath, contents, (value) => (isRecord(value) ? value : null));
              const stored = isRecord(parsed) ? parsed[LEGACY_AGENTS_STATE_KEY] : null;
              if (!isRecord(parsed) || !isBoolean(parsed.examplesInitialized) || !Array.isArray(stored)) {
                throw new Error(sourceText("error.agent.stateCorrupt"));
              }
              if (stored.some((agent) => isRecord(agent) && "role" in agent)) {
                throw new Error(sourceText("error.agent.oldRoleField"));
              }

              let agents: StoredAgent[];
              if (parsed.version === 1 && stored.every(isLegacyStoredAgent)) {
                agents = stored.map(migrateLegacyAgent);
              } else if (parsed.version === 2 && stored.every(isStoredAgent)) {
                agents = stored.map(normalizeStoredAgent);
              } else {
                throw new Error(sourceText("error.agent.stateCorrupt"));
              }
              if (new Set(agents.map((agent) => agent.id)).size !== agents.length) {
                throw new Error(sourceText("error.agent.duplicateIds"));
              }
              const state: StoredState = { version: 2, examplesInitialized: parsed.examplesInitialized, agents };
              return state;
            } catch (cause) {
              return yield* new StoredStateFailure({ cause });
            }
          }),
        );
        if (Result.isFailure(attempt8)) {
          const error = attempt8.failure.cause;
          if (isRecord(error) && error.code === "ENOENT") {
            return { version: 2, examplesInitialized: false, agents: [] };
          }
          throw error;
        } else {
          return attempt8.success;
        }
      }
    } catch (cause) {
      return yield* new StoredStateFailure({ cause });
    }
  }, Effect.uninterruptible);

  #restoreRosterFromEvents(): void {
    const replayed = this.#database.latestRosterAgents();
    if (replayed.length === 0) return;
    const readable: StoredAgent[] = [];
    for (const value of replayed) {
      const read = readStoredAgent(value);
      if ("unreadable" in read) continue;
      readable.push(normalizeStoredAgent(read.agent));
    }
    const present = new Set(this.#state.agents.map((agent) => agent.id));
    const restored = readable.filter((agent) => !present.has(agent.id));
    if (restored.length === 0) return;
    const dropped = replayed.length - readable.length;
    if (dropped > 0) logger.warn("Agent profiles in the roster event log cannot be read.", dropped);
    this.#state = { ...this.#state, agents: [...this.#state.agents, ...restored] };
    this.#persist("agents.replaced");
    logger.warn("Agents were restored to the roster from the event log.", restored.length);
  }

  #resetClaudeFastModeOnce(): void {
    if (this.#database.commandResult(CLAUDE_FAST_MODE_RESET_COMMAND_ID) !== undefined) return;
    const agentIds = this.#state.agents
      .filter((agent) => agent.provider === "claude" && agent.fastMode)
      .map((agent) => agent.id);
    const previous = this.#state.agents;
    try {
      this.#database.dispatch(
        CLAUDE_FAST_MODE_RESET_COMMAND_ID,
        [
          {
            aggregateType: "agent-fast-mode",
            aggregateId: "claude-reset",
            eventType: "agent-fast-mode.claude-reset",
            payload: { agentIds },
          },
        ],
        () => {
          if (agentIds.length === 0) return null;
          this.#state.agents = previous.map((agent) =>
            agentIds.includes(agent.id) ? { ...agent, fastMode: false } : agent,
          );
          this.#persist("agents.claude-fast-mode-reset");
          return null;
        },
      );
    } catch (cause) {
      this.#state.agents = previous;
      throw cause;
    }
    if (agentIds.length > 0) logger.info("Fast mode was turned off for Claude agents.", { count: agentIds.length });
  }

  #persist(eventType: string, modelChange?: AgentModelChange): void {
    this.#database.replaceAgents(`agents:${eventType}:${randomUUID()}`, this.#state.agents, eventType, modelChange);
  }

  #createRecord(id: string, name: string, title: string, description = ""): StoredAgent {
    validateAgentId(id);
    return {
      id,
      name,
      title,
      description,
      notifications: true,
      provider: DEFAULT_AGENT_PROVIDER,
      model: DEFAULT_AGENT_MODEL,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      access: DEFAULT_AGENT_ACCESS,
      computerUse: true,
      threadId: null,
      workspacePath: join(this.#agentsRoot, id),
      preview: NEW_AGENT_PREVIEW,
      updatedAt: null,
      avatarSeed: id,
      avatarHue: null,
      avatarUrl: null,
    };
  }

  #requireAgent(id: string): StoredAgent {
    const agent = this.#state.agents.find((candidate) => candidate.id === id);
    if (!agent) throw new Error(sourceText("error.agent.unknown", { id }));
    return agent;
  }
}

function requiredText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`);
  return trimmed;
}

function limitedText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`);
  return trimmed;
}

function duplicateAgentName(sourceName: string, agents: readonly StoredAgent[]): string {
  const match = /^(.*?)(?: copy(?: (\d+))?)$/iu.exec(sourceName);
  const base = match?.[1]?.trim() || sourceName.trim();
  const existing = new Set(agents.map((agent) => agent.name.toLocaleLowerCase()));
  for (let index = 1; index <= INPUT_LIMITS.agents + 1; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const candidate = `${base.slice(0, Math.max(1, INPUT_LIMITS.agentName - suffix.length)).trimEnd()}${suffix}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error(sourceText("error.agent.copyNameFailed"));
}

export function duplicationProfileSignature(agent: AgentSummary): string {
  const { preview, updatedAt, threadId, ...copied } = agent;
  return JSON.stringify(copied);
}

function duplicationCommandId(operationId: string): string {
  return `agent-duplication:${operationId}`;
}

const rewriteInternalWorkspaceSymlinksEffect = Effect.fn("AgentStore.rewriteWorkspaceSymlinks")(function* (
  sourceRoot: string,
  stagedRoot: string,
  finalRoot: string,
) {
  const canonicalSourceRoot = yield* storedIO(() => realpath(sourceRoot));
  const visit = Effect.fn("AgentStore.visitWorkspaceSymlinks")(function* (
    stagedDirectory: string,
    sourceDirectory: string,
    finalDirectory: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    const entries = yield* storedIO(() => readdir(stagedDirectory, { withFileTypes: true }));
    for (const entry of entries) {
      const stagedPath = join(stagedDirectory, entry.name);
      const sourcePath = join(sourceDirectory, entry.name);
      const finalPath = join(finalDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = yield* storedIO(() => readlink(stagedPath));
        const finalTarget = yield* copiedInternalLinkTargetEffect(
          canonicalSourceRoot,
          sourceRoot,
          finalRoot,
          sourcePath,
          target,
        );
        if (finalTarget === null) continue;
        const rewrittenTarget = isAbsolute(target) ? finalTarget : relative(dirname(finalPath), finalTarget) || ".";
        yield* storedIO(() => rm(stagedPath));
        yield* storedIO(() => symlink(rewrittenTarget, stagedPath));
      } else if (entry.isDirectory()) yield* visit(stagedPath, sourcePath, finalPath);
    }
  });
  yield* visit(stagedRoot, sourceRoot, finalRoot);
});

const copiedInternalLinkTargetEffect = Effect.fn("AgentStore.copiedInternalLinkTarget")(function* (
  canonicalSourceRoot: string,
  sourceRoot: string,
  finalRoot: string,
  sourcePath: string,
  target: string,
): Effect.fn.Return<string | null, StoredStateFailure> {
  const resolvedSourceTarget = resolve(dirname(sourcePath), target);
  const resolved = yield* Effect.result(storedIO(() => realpath(resolvedSourceTarget)));
  if (Result.isSuccess(resolved)) {
    if (!isPathInside(canonicalSourceRoot, resolved.success)) return null;
    return join(finalRoot, relative(canonicalSourceRoot, resolved.success));
  }
  if (!isPathInside(sourceRoot, resolvedSourceTarget)) return null;
  return join(finalRoot, relative(sourceRoot, resolvedSourceTarget));
});

function skipFolderLinksOnWindows(sourceRoot: string, skipped: string[]): CopyOptions["filter"] {
  if (process.platform !== "win32") return undefined;
  return async (path) => {
    if (path === sourceRoot || !(await lstat(path)).isSymbolicLink()) return true;
    const isFolder = await stat(path).then(
      (stats) => stats.isDirectory(),
      () => false,
    );
    if (isFolder) skipped.push(path);
    return !isFolder;
  };
}

const copyFolderLinksEffect = Effect.fn("AgentStore.copyFolderLinks")(function* (
  sourceLinks: readonly string[],
  sourceRoot: string,
  stagedRoot: string,
  finalRoot: string,
) {
  if (sourceLinks.length === 0) return;
  const canonicalSourceRoot = yield* storedIO(() => realpath(sourceRoot));
  for (const sourcePath of sourceLinks) {
    const linkPath = relative(sourceRoot, sourcePath);
    const stagedPath = join(stagedRoot, linkPath);
    const target = yield* storedIO(() => readlink(sourcePath));
    const internalTarget = yield* copiedInternalLinkTargetEffect(
      canonicalSourceRoot,
      sourceRoot,
      finalRoot,
      sourcePath,
      target,
    );
    const symlinkTarget =
      internalTarget === null
        ? target
        : isAbsolute(target)
          ? internalTarget
          : relative(dirname(join(finalRoot, linkPath)), internalTarget) || ".";
    const linked = yield* Effect.result(storedIO(() => symlink(symlinkTarget, stagedPath, "dir")));
    if (Result.isSuccess(linked)) continue;
    if (!isRecord(linked.failure.cause) || linked.failure.cause.code !== "EPERM") return yield* linked.failure;
    const junctionTarget = internalTarget ?? resolve(dirname(sourcePath), target);
    yield* storedIO(() => symlink(junctionTarget, stagedPath, "junction"));
  }
});

const renameCopiedFolderEffect = Effect.fn("AgentStore.renameCopiedFolder")(function* (from: string, to: string) {
  for (let attempt = 0; ; attempt += 1) {
    const renamed = yield* Effect.result(storedIO(() => rename(from, to)));
    if (Result.isSuccess(renamed)) return;
    const wait = HELD_COPIED_FOLDER_WAITS_MS[attempt];
    if (wait === undefined || !isHeldTargetError(renamed.failure.cause)) return yield* renamed.failure;
    yield* Effect.sleep(wait);
  }
});

const workspaceMetadataFingerprintEffect = Effect.fn("AgentStore.workspaceFingerprint")(function* (root: string) {
  const hash = createHash("sha256");
  const visit = Effect.fn("AgentStore.visitWorkspaceMetadata")(function* (
    directory: string,
    prefix: string,
  ): Effect.fn.Return<void, StoredStateFailure> {
    const entries = yield* storedIO(() => readdir(directory, { withFileTypes: true }));
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stats = yield* storedIO(() => lstat(path, { bigint: true }));
      hash.update(`${relativePath}\0${stats.mode}\0${stats.size}\0${stats.mtimeNs}\0${stats.ctimeNs}\0`);
      if (stats.isSymbolicLink()) hash.update(`link\0${yield* storedIO(() => readlink(path))}\0`);
      else if (stats.isDirectory()) {
        hash.update("directory\0");
        yield* visit(path, relativePath);
      } else if (stats.isFile()) hash.update("file\0");
      else hash.update("other\0");
    }
  });
  yield* visit(root, "");
  return hash.digest("hex");
});

const fileFingerprintEffect = Effect.fn("AgentStore.fileFingerprint")(function* (path: string) {
  const stats = yield* storedIO(() => lstat(path));
  const hash = createHash("sha256");
  hash.update(`${stats.mode}\0`);
  yield* Effect.acquireUseRelease(
    storedSync(() => createReadStream(path)),
    (stream) =>
      Stream.fromAsyncIterable(stream, (cause) => new StoredStateFailure({ cause })).pipe(
        Stream.runForEach((chunk) =>
          storedSync(() => {
            hash.update(chunk);
          }),
        ),
      ),
    (stream) =>
      Effect.sync(() => {
        stream.destroy();
      }),
  );
  return hash.digest("hex");
});

function validateAgentId(id: string): void {
  if (!isValidAgentId(id)) {
    throw new Error("Invalid agent id.");
  }
}

function isValidAgentId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && basename(id) === id;
}

const directoryExistsEffect = Effect.fn("AgentStore.directoryExists")((path: string) =>
  storedIO(() => lstat(path)).pipe(
    Effect.map((stats) => stats.isDirectory()),
    Effect.catch((failure) =>
      isRecord(failure.cause) && failure.cause.code === "ENOENT" ? Effect.succeed(false) : Effect.fail(failure),
    ),
  ),
);
const fileExistsEffect = Effect.fn("AgentStore.fileExists")((path: string) =>
  storedIO(() => lstat(path)).pipe(
    Effect.map((stats) => stats.isFile()),
    Effect.catch((failure) =>
      isRecord(failure.cause) && failure.cause.code === "ENOENT" ? Effect.succeed(false) : Effect.fail(failure),
    ),
  ),
);
const probeDirectoryEffect = Effect.fn("AgentStore.probeDirectory")((path: string) =>
  directoryExistsEffect(path).pipe(
    Effect.catch(({ cause }) =>
      Effect.sync(() => {
        logger.warn("Could not check an agent directory during startup reconciliation.", toLogValue(cause));
        return null;
      }),
    ),
  ),
);

function isApplicationWorkspacePath(workspacePath: string, agentId: string): boolean {
  const parts = workspacePath.split(/[\\/]+/);
  const name = parts.at(-1);
  const folder = parts.at(-2);
  if (folder === "Agents") return name === agentId;
  return folder === "Bots" && (name === agentId || name === legacyAgentId(agentId));
}

function rebasedFolder(folder: string, from: string, to: string): string {
  if (isPathInside(from, folder)) return join(to, relative(from, folder));
  const fromParts = from.split(/[\\/]+/);
  const parts = folder.split(/[\\/]+/);
  const inside = parts.length > fromParts.length && fromParts.every((part, index) => part === parts[index]);
  return inside ? join(to, ...parts.slice(fromParts.length)) : folder;
}

function titleFromId(id: string): string {
  return id
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isStoredAgentBase(value: unknown): value is StoredAgentBase {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isValidAgentId(value.id) &&
    isString(value.name) &&
    isString(value.title) &&
    isString(value.description) &&
    isBoolean(value.notifications) &&
    isAgentModel(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (isString(value.threadId) || value.threadId === null) &&
    isString(value.workspacePath) &&
    isString(value.preview) &&
    (isString(value.updatedAt) || value.updatedAt === null)
  );
}

function isStoredAgent(value: unknown): value is PersistedStoredAgent {
  if (!isRecord(value) || !isStoredAgentBase(value)) return false;
  const record = value;
  return (
    (record.provider === undefined || isOneOf(AGENT_PROVIDERS, record.provider)) &&
    (record.sessionSettingOverrides === undefined || isAgentSessionSettingOverrides(record.sessionSettingOverrides)) &&
    (record.sessionSettingResets === undefined || isAgentSessionSettingResets(record.sessionSettingResets)) &&
    (record.access === undefined || isAgentAccess(record.access)) &&
    (record.additionalFolders === undefined || isAgentAdditionalFolders(record.additionalFolders)) &&
    (record.excludedFolders === undefined || isAgentAdditionalFolders(record.excludedFolders)) &&
    (record.computerUse === undefined || isBoolean(record.computerUse)) &&
    (record.allowAutomation === undefined || isBoolean(record.allowAutomation)) &&
    (record.allowNewChat === undefined || isBoolean(record.allowNewChat)) &&
    (record.quickAcknowledgement === undefined || isBoolean(record.quickAcknowledgement)) &&
    (record.memory === undefined || record.memory === false) &&
    (record.ownBrowserSession === undefined || isBoolean(record.ownBrowserSession)) &&
    (record.browserProfileId === undefined || isBrowserProfileId(record.browserProfileId)) &&
    (record.fastMode === undefined || isBoolean(record.fastMode)) &&
    (record.ultrafast === undefined || isBoolean(record.ultrafast)) &&
    (record.busyMessageMode === undefined || isBusyMessageMode(record.busyMessageMode)) &&
    (record.taskLimit === undefined || isAgentTaskLimit(record.taskLimit)) &&
    (record.providerAccountId === undefined || isProviderAccountId(record.providerAccountId)) &&
    (record.backupModels === undefined || isAgentBackupModels(record.backupModels)) &&
    (record.usageLimitReturn === undefined || isAgentUsageLimitReturn(record.usageLimitReturn)) &&
    (record.pendingRuntime === undefined || isAgentPendingRuntime(record.pendingRuntime)) &&
    (record.pinnedAccountId === undefined || isProviderAccountId(record.pinnedAccountId)) &&
    (record.hiddenAt === undefined || isHiddenAt(record.hiddenAt)) &&
    isAvatarSeed(record.avatarSeed) &&
    (record.avatarHue === null || isAvatarHue(record.avatarHue)) &&
    (record.avatarColor === undefined || isAvatarColor(record.avatarColor)) &&
    (record.chatColor === undefined || isAvatarColor(record.chatColor)) &&
    isMarketplaceSource(record.marketplaceSource)
  );
}

interface ReadStoredAgent {
  agent: PersistedStoredAgent;
  repaired: string[];
}

interface UnreadableStoredAgent {
  unreadable: string;
  id: string | null;
}

function readStoredAgent(value: unknown): ReadStoredAgent | UnreadableStoredAgent {
  if (!isRecord(value)) return { unreadable: "profile", id: null };
  const id = value.id;
  if (!isString(id) || !isValidAgentId(id)) return { unreadable: "id", id: null };
  if (!isString(value.workspacePath)) return { unreadable: "workspacePath", id };
  if (value.threadId !== null && !isString(value.threadId)) return { unreadable: "threadId", id };

  const repaired: string[] = [];
  const reset = <T>(field: string, fallback: T): T => {
    repaired.push(field);
    return fallback;
  };
  const provider =
    value.provider === undefined || isOneOf(AGENT_PROVIDERS, value.provider)
      ? value.provider
      : reset("provider", undefined);
  const model = isAgentModel(value.model)
    ? value.model
    : reset("model", provider === undefined ? DEFAULT_AGENT_MODEL : defaultProviderModel(provider));
  const access =
    value.access === undefined || isAgentAccess(value.access) ? value.access : reset("access", DEFAULT_AGENT_ACCESS);
  const additionalFolders =
    value.additionalFolders === undefined || isAgentAdditionalFolders(value.additionalFolders)
      ? value.additionalFolders
      : readableFolders(value.additionalFolders, () => repaired.push("additionalFolders"));
  const excludedFolders =
    value.excludedFolders === undefined || isAgentAdditionalFolders(value.excludedFolders)
      ? value.excludedFolders
      : readableFolders(value.excludedFolders, () => repaired.push("excludedFolders"));
  const computerUse =
    value.computerUse === undefined || isBoolean(value.computerUse) ? value.computerUse : reset("computerUse", true);
  const allowAutomation =
    value.allowAutomation === undefined || isBoolean(value.allowAutomation)
      ? value.allowAutomation
      : reset("allowAutomation", undefined);
  const allowNewChat =
    value.allowNewChat === undefined || isBoolean(value.allowNewChat)
      ? value.allowNewChat
      : reset("allowNewChat", undefined);
  const quickAcknowledgement =
    value.quickAcknowledgement === undefined || isBoolean(value.quickAcknowledgement)
      ? value.quickAcknowledgement
      : reset("quickAcknowledgement", undefined);
  const memory = value.memory === undefined || value.memory === false ? value.memory : reset("memory", undefined);
  const ownBrowserSession =
    value.ownBrowserSession === undefined || isBoolean(value.ownBrowserSession)
      ? value.ownBrowserSession
      : reset("ownBrowserSession", undefined);
  const browserProfileId =
    value.browserProfileId === undefined || isBrowserProfileId(value.browserProfileId)
      ? value.browserProfileId
      : reset("browserProfileId", undefined);
  const fastMode =
    value.fastMode === undefined || isBoolean(value.fastMode) ? value.fastMode : reset("fastMode", undefined);
  const ultrafast =
    value.ultrafast === undefined || isBoolean(value.ultrafast) ? value.ultrafast : reset("ultrafast", undefined);
  const busyMessageMode =
    value.busyMessageMode === undefined || isBusyMessageMode(value.busyMessageMode)
      ? value.busyMessageMode
      : reset("busyMessageMode", undefined);
  const taskLimit =
    value.taskLimit === undefined || isAgentTaskLimit(value.taskLimit)
      ? value.taskLimit
      : reset("taskLimit", undefined);
  const providerAccountId =
    value.providerAccountId === undefined || isProviderAccountId(value.providerAccountId)
      ? value.providerAccountId
      : reset("providerAccountId", undefined);
  const backupModels =
    value.backupModels === undefined || isAgentBackupModels(value.backupModels)
      ? value.backupModels
      : reset("backupModels", undefined);
  const usageLimitReturn =
    value.usageLimitReturn === undefined || isAgentUsageLimitReturn(value.usageLimitReturn)
      ? value.usageLimitReturn
      : reset("usageLimitReturn", undefined);
  const pendingRuntime =
    value.pendingRuntime === undefined || isAgentPendingRuntime(value.pendingRuntime)
      ? value.pendingRuntime
      : reset("pendingRuntime", undefined);
  const pinnedAccountId =
    value.pinnedAccountId === undefined || isProviderAccountId(value.pinnedAccountId)
      ? value.pinnedAccountId
      : reset("pinnedAccountId", undefined);
  const hiddenAt =
    value.hiddenAt === undefined || isHiddenAt(value.hiddenAt)
      ? value.hiddenAt
      : reset("hiddenAt", new Date().toISOString());
  const avatarHue =
    value.avatarHue === null || isAvatarHue(value.avatarHue) ? value.avatarHue : reset("avatarHue", null);
  const avatarColor =
    value.avatarColor === undefined || isAvatarColor(value.avatarColor)
      ? value.avatarColor
      : reset("avatarColor", undefined);
  const chatColor =
    value.chatColor === undefined || isAvatarColor(value.chatColor) ? value.chatColor : reset("chatColor", undefined);
  let marketplaceSource: StoredAgent["marketplaceSource"];
  if (value.marketplaceSource !== undefined) {
    if (isMarketplaceSource(value.marketplaceSource)) {
      marketplaceSource = normalizeMarketplaceSource(value.marketplaceSource);
    } else {
      reset("marketplaceSource", undefined);
    }
  }
  const sessionSettingResets =
    value.sessionSettingResets === undefined || isAgentSessionSettingResets(value.sessionSettingResets)
      ? value.sessionSettingResets
      : reset("sessionSettingResets", undefined);
  const sessionSettingOverrides =
    value.sessionSettingOverrides === undefined || isAgentSessionSettingOverrides(value.sessionSettingOverrides)
      ? value.sessionSettingOverrides
      : reset("sessionSettingOverrides", undefined);
  const agent: PersistedStoredAgent = {
    id,
    name: isString(value.name) ? value.name : reset("name", titleFromId(id)),
    title: isString(value.title) ? value.title : reset("title", ""),
    description: isString(value.description) ? value.description : reset("description", ""),
    notifications: isBoolean(value.notifications) ? value.notifications : reset("notifications", true),
    model,
    reasoningEffort: isReasoningEffort(value.reasoningEffort)
      ? value.reasoningEffort
      : reset("reasoningEffort", DEFAULT_REASONING_EFFORT),
    threadId: value.threadId,
    workspacePath: value.workspacePath,
    preview: isString(value.preview) ? value.preview : reset("preview", NEW_AGENT_PREVIEW),
    updatedAt: isString(value.updatedAt) || value.updatedAt === null ? value.updatedAt : reset("updatedAt", null),
    avatarSeed: isAvatarSeed(value.avatarSeed) ? value.avatarSeed : reset("avatarSeed", id),
    avatarHue,
    ...(avatarColor === undefined ? {} : { avatarColor }),
    ...(chatColor === undefined ? {} : { chatColor }),
    avatarUrl: isString(value.avatarUrl) ? value.avatarUrl : null,
    ...(provider === undefined ? {} : { provider }),
    ...(access === undefined ? {} : { access }),
    ...(additionalFolders === undefined || additionalFolders.length === 0 ? {} : { additionalFolders }),
    ...(excludedFolders === undefined || excludedFolders.length === 0 ? {} : { excludedFolders }),
    ...(computerUse === undefined ? {} : { computerUse }),
    ...(allowAutomation === undefined ? {} : { allowAutomation }),
    ...(allowNewChat === undefined ? {} : { allowNewChat }),
    ...(quickAcknowledgement === undefined ? {} : { quickAcknowledgement }),
    ...(memory === undefined ? {} : { memory }),
    ...(ownBrowserSession === undefined ? {} : { ownBrowserSession }),
    ...(browserProfileId === undefined ? {} : { browserProfileId }),
    ...(fastMode === undefined ? {} : { fastMode }),
    ...(ultrafast && fastMode ? { ultrafast } : {}),
    ...(busyMessageMode === undefined ? {} : { busyMessageMode }),
    ...(taskLimit === undefined ? {} : { taskLimit }),
    ...(providerAccountId === undefined ? {} : { providerAccountId }),
    ...(backupModels === undefined ? {} : { backupModels }),
    ...(usageLimitReturn === undefined ? {} : { usageLimitReturn }),
    ...(pendingRuntime === undefined ? {} : { pendingRuntime }),
    ...(pinnedAccountId === undefined ? {} : { pinnedAccountId }),
    ...(hiddenAt === undefined ? {} : { hiddenAt }),
    ...(sessionSettingOverrides === undefined ? {} : { sessionSettingOverrides }),
    ...(sessionSettingResets === undefined ? {} : { sessionSettingResets }),
    ...(marketplaceSource === undefined ? {} : { marketplaceSource }),
  };
  return { agent, repaired };
}

function unreadableProfileMessage({ unreadable, id }: UnreadableStoredAgent): string {
  if (id === null) return sourceText("error.agent.storedProfileUnreadable", { field: unreadable });
  return sourceText("error.agent.storedProfileUnreadableId", { id, field: unreadable });
}

function isMarketplaceSource(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    isRecord(value) &&
    (isString(value.listingId) || isString(value.agentId)) &&
    isString(value.versionId) &&
    isNumber(value.version) &&
    Number.isInteger(value.version) &&
    value.version > 0 &&
    Array.isArray(value.skillIds) &&
    value.skillIds.every(isString) &&
    Array.isArray(value.routineIds) &&
    value.routineIds.every(isString)
  );
}

function isLegacyStoredAgent(value: unknown): value is LegacyStoredAgent {
  if (!isRecord(value) || !isStoredAgentBase(value)) return false;
  const record = value;
  return (
    isString(record.avatarShape) &&
    isOneOf(LEGACY_AVATAR_VARIANTS, record.avatarShape) &&
    isString(record.avatarColor) &&
    isOneOf(LEGACY_AVATAR_COLORS, record.avatarColor)
  );
}

function applyAvatarColor(
  agent: Pick<StoredAgent, "avatarHue" | "avatarColor">,
  hue: AvatarHue | null,
  color: AvatarColor | null | undefined,
  hueChanged = true,
): void {
  if (color) {
    agent.avatarColor = color;
    agent.avatarHue = nearestAvatarHue(color);
    return;
  }
  agent.avatarHue = hue;
  if (color === null || hueChanged) delete agent.avatarColor;
}

function migrateLegacyAgent(agent: LegacyStoredAgent): StoredAgent {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    notifications: agent.notifications,
    provider: providerForLegacyModel(agent.model),
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    access: DEFAULT_AGENT_ACCESS,
    computerUse: true,
    threadId: agent.threadId,
    workspacePath: agent.workspacePath,
    preview: agent.preview,
    updatedAt: agent.updatedAt,
    avatarSeed: agent.id,
    avatarHue: null,
    avatarUrl: null,
  };
}

function readableFolders(value: unknown, repair: () => void): string[] {
  repair();
  if (!Array.isArray(value)) return [];
  return value
    .filter((path): path is string => isString(path) && path.length > 0 && path.length <= INPUT_LIMITS.path)
    .slice(0, AGENT_FOLDER_LIMIT);
}

function normalizeStoredAgent(agent: PersistedStoredAgent): StoredAgent {
  return {
    ...agent,
    provider: agent.provider ?? providerForLegacyModel(agent.model),
    access: agent.access ?? DEFAULT_AGENT_ACCESS,
    computerUse: agent.computerUse ?? true,
    avatarUrl: isString(agent.avatarUrl) && parseAgentAvatarUrl(agent.avatarUrl, agent.id) ? agent.avatarUrl : null,
    ...(agent.marketplaceSource === undefined
      ? {}
      : { marketplaceSource: normalizeMarketplaceSource(agent.marketplaceSource) }),
  };
}

function normalizeMarketplaceSource(value: unknown): NonNullable<StoredAgent["marketplaceSource"]> {
  if (!isRecord(value)) throw new Error("The stored marketplace source is invalid.");
  const listingId = isString(value.listingId) ? value.listingId : value.agentId;
  if (!isString(listingId) || !isString(value.versionId) || !isNumber(value.version)) {
    throw new Error("The stored marketplace source has no listing id.");
  }
  return {
    listingId,
    versionId: value.versionId,
    version: value.version,
    skillIds: stringList(value.skillIds),
    routineIds: stringList(value.routineIds),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(isString)) throw new Error("The stored marketplace source is invalid.");
  return [...value];
}

function agentAvatarUrl(agentId: string, version: string, mimeType: string): string {
  const url = new URL(`openbot-avatar://agent/${encodeURIComponent(agentId)}`);
  url.searchParams.set("v", version);
  url.searchParams.set("type", mimeType);
  return url.toString();
}

function parseAgentAvatarUrl(
  value: string,
  expectedAgentId: string,
): { version: string; mimeType: AvatarImageInput["mimeType"] } | null {
  try {
    const url = new URL(value);
    const agentId = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
    const version = url.searchParams.get("v") ?? "";
    const mimeType = url.searchParams.get("type") ?? "";
    if (
      url.protocol !== "openbot-avatar:" ||
      url.hostname !== "agent" ||
      agentId !== expectedAgentId ||
      !isUuidV4(version) ||
      !isAvatarMimeType(mimeType)
    ) {
      return null;
    }
    return { version, mimeType };
  } catch {
    return null;
  }
}
