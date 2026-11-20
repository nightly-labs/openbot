import { isAgentProvider } from "@openbot/contracts/agent-providers";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isAgentImportKey,
  isAgentTaskLimit,
  isAvatarHue,
  isBusyMessageMode,
  isMcpServerConfig,
  isReasoningEffort,
  isRoutineSchedule,
  ROUTINE_LIMIT_POLICIES,
  ROUTINE_MISSED_POLICIES,
  ROUTINE_RUN_PLACES,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Result, Schema } from "effect";
import { ServerPreferencesInFile, type TransferServerPreferences } from "./instance-transfer-server-preferences";
import { TRANSFER_WORKFLOWS } from "./instance-transfer-workflows";
import { isUnsafeArchivePath } from "./skill-package";

export { INSTANCE_TRANSFER_MANIFEST } from "@openbot/team-client/instance-transfer-copy";
export const INSTANCE_TRANSFER_FORMAT = "openbot-instance-transfer";
export const INSTANCE_TRANSFER_VERSION = 1;
export const SHARED_FOLDER = "shared";
export const SERVER_FOLDER = "server";
export const LIBRARY_FOLDER = "library";
const TRANSFER_MEMBERS = 1000;
export const TRANSFER_SHARED_SKILLS = 1000;
export const SHARED_SKILL_BYTES = 10 * 1024 * 1024;
export const TRANSFER_CHANNELS = 1000;
const INSTANCE_TRANSFER_CHANNEL_FILES = 50_000;

const text = (limit: number) => Schema.String.check(Schema.isMaxLength(limit));
const name = (limit: number) => text(limit).check(Schema.isMinLength(1));
const guarded = <T>(is: (value: unknown) => value is T) => Schema.declare(is);
const Key = guarded(isAgentImportKey);
const Provider = guarded(isAgentProvider);

const Routine = Schema.Struct({
  key: name(INPUT_LIMITS.identifier),
  name: name(INPUT_LIMITS.routineName),
  instruction: name(INPUT_LIMITS.routineInstruction),
  active: Schema.Boolean,
  timezone: text(64),
  schedule: guarded(isRoutineSchedule),
  limitPolicy: Schema.optionalKey(Schema.Literals(ROUTINE_LIMIT_POLICIES)),
  missedPolicy: Schema.optionalKey(Schema.Literals(ROUTINE_MISSED_POLICIES)),
  runIn: Schema.optionalKey(Schema.Literals(ROUTINE_RUN_PLACES)),
  runs: Schema.optionalKey(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(INPUT_LIMITS.routineRunsPage))),
});

const Memory = Schema.Struct({
  text: name(INPUT_LIMITS.agentMemoryText),
  inclusion: Schema.optionalKey(Schema.Literals(["essential", "searchable"])),
});

const Agent = Schema.Struct({
  key: Key,
  name: name(INPUT_LIMITS.agentName),
  title: text(INPUT_LIMITS.agentTitle),
  description: text(INPUT_LIMITS.agentDescription),
  avatarSeed: text(128),
  avatarHue: Schema.NullOr(guarded(isAvatarHue)),
  avatarColor: Schema.optionalKey(Schema.String),
  chatColor: Schema.optionalKey(Schema.String),
  avatar: Schema.NullOr(text(512)),
  provider: Provider,
  model: name(256),
  reasoningEffort: guarded(isReasoningEffort),
  notifications: Schema.Boolean,
  busyMessageMode: Schema.optionalKey(guarded(isBusyMessageMode)),
  taskLimit: Schema.optionalKey(guarded(isAgentTaskLimit)),
  skills: Schema.Array(text(512)).check(Schema.isMaxLength(INPUT_LIMITS.agentSkills)),
  files: Schema.NullOr(text(512)),
  routines: Schema.Array(Routine).check(Schema.isMaxLength(INPUT_LIMITS.agentRoutines)),
  oneTimeRoutines: Schema.optionalKey(Schema.Array(Routine).check(Schema.isMaxLength(INPUT_LIMITS.agentRoutines))),
  memories: Schema.Array(Memory).check(Schema.isMaxLength(512)),
  preferences: Schema.optionalKey(Schema.Unknown),
  history: Schema.optionalKey(text(512)),
  webhookRoutines: Schema.optionalKey(
    Schema.Array(Schema.Unknown).check(Schema.isMaxLength(INPUT_LIMITS.agentRoutines)),
  ),
});

const Settings = Schema.Struct({
  mcpServers: Schema.Array(guarded(isMcpServerConfig)).check(Schema.isMaxLength(INPUT_LIMITS.mcpServers)),
  customProviders: Schema.Array(
    Schema.Struct({
      id: name(64),
      name: name(128),
      baseUrl: name(2048),
      models: Schema.Array(
        Schema.Struct({
          id: name(256),
          name: text(256),
          contextWindow: Schema.optionalKey(Schema.Number),
          maxOutput: Schema.optionalKey(Schema.Number),
          reasoningEfforts: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(16))),
          inputs: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(16))),
        }),
      ).check(Schema.isMaxLength(256)),
      needsApiKey: Schema.Boolean,
      harness: Schema.optionalKey(Schema.String),
    }),
  ).check(Schema.isMaxLength(32)),
  customAgents: Schema.Array(
    Schema.Struct({
      id: name(64),
      name: name(128),
      command: name(4096),
      args: Schema.Array(text(4096)).check(Schema.isMaxLength(64)),
      envNames: Schema.Array(text(256)).check(Schema.isMaxLength(64)),
    }),
  ).check(Schema.isMaxLength(32)),
  sidebarSections: Schema.Array(
    Schema.Struct({ name: name(128), agentKeys: Schema.Array(Key).check(Schema.isMaxLength(INPUT_LIMITS.agents)) }),
  ).check(Schema.isMaxLength(64)),
  routineFlows: Schema.Array(
    Schema.Struct({
      routineKey: name(INPUT_LIMITS.identifier),
      fromAgentKey: Key,
      toAgentKey: Key,
      instruction: text(INPUT_LIMITS.routineInstruction),
    }),
  ).check(Schema.isMaxLength(512)),
  cleared: Schema.optionalKey(Schema.Array(name(128)).check(Schema.isMaxLength(128))),
  workflows: Schema.optionalKey(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(TRANSFER_WORKFLOWS))),
  routineFlowPositions: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ agentKey: Key, nodeKey: name(INPUT_LIMITS.identifier + 16), x: Schema.Number, y: Schema.Number }),
    ).check(Schema.isMaxLength(5_000)),
  ),
});

const Channel = Schema.Struct({
  key: name(INPUT_LIMITS.identifier),
  name: name(INPUT_LIMITS.agentName),
  title: text(INPUT_LIMITS.agentTitle),
  instructions: text(INPUT_LIMITS.agentDescription),
  members: Schema.Array(Key).check(Schema.isMaxLength(INPUT_LIMITS.agents)),
  lead: Schema.NullOr(Key),
  isolated: Schema.optionalKey(Schema.Boolean),
  browser: Schema.optionalKey(Schema.Unknown),
  icon: Schema.optionalKey(Schema.Unknown),
  image: Schema.NullOr(text(512)),
  archived: Schema.Boolean,
  memories: Schema.Array(name(INPUT_LIMITS.agentMemoryText)).check(Schema.isMaxLength(INPUT_LIMITS.channelMemories)),
  routines: Schema.Array(Routine).check(Schema.isMaxLength(INPUT_LIMITS.agentRoutines)),
  webhookRoutines: Schema.optionalKey(
    Schema.Array(Schema.Unknown).check(Schema.isMaxLength(INPUT_LIMITS.agentRoutines)),
  ),
  messages: Schema.optionalKey(Schema.Array(text(512)).check(Schema.isMaxLength(10_000))),
  files: Schema.optionalKey(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(INSTANCE_TRANSFER_CHANNEL_FILES))),
});

const Manifest = Schema.Struct({
  format: Schema.Literal(INSTANCE_TRANSFER_FORMAT),
  version: Schema.Number,
  source: Schema.Struct({ appVersion: text(64), exportedAt: Schema.NullOr(text(64)) }),
  agents: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(INPUT_LIMITS.agents)),
  settings: Schema.NullOr(Schema.Unknown),
  shared: Schema.NullOr(Schema.Literal(SHARED_FOLDER)),
  signedIn: Schema.Array(Provider).check(Schema.isMaxLength(32)),
  channels: Schema.optionalKey(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(TRANSFER_CHANNELS))),
  exporter: Schema.optionalKey(text(128)),
  serverPreferences: Schema.optionalKey(ServerPreferencesInFile),
  serverIdentity: Schema.optionalKey(Schema.Unknown),
  sharedSkills: Schema.optionalKey(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(TRANSFER_SHARED_SKILLS))),
  memberPreferences: Schema.optionalKey(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(TRANSFER_MEMBERS))),
});

export type TransferAgent = typeof Agent.Type;
export type TransferSettings = typeof Settings.Type;
export type TransferChannel = typeof Channel.Type;

export interface TransferManifest {
  appVersion: string;
  exportedAt: string | null;
  agents: TransferAgent[];
  settings: TransferSettings | null;
  shared: string | null;
  signedIn: readonly (typeof Provider.Type)[];
  channels: TransferChannel[];
  exporter: string | null;
  serverPreferences: typeof ServerPreferencesInFile.Type | null;
  serverIdentity: unknown;
  sharedSkills: readonly unknown[];
  memberPreferences: readonly unknown[];
}

export interface TransferManifestFile {
  format: typeof INSTANCE_TRANSFER_FORMAT;
  version: typeof INSTANCE_TRANSFER_VERSION;
  source: { appVersion: string; exportedAt: string };
  agents: TransferAgent[];
  settings: TransferSettings | null;
  shared: typeof SHARED_FOLDER | null;
  signedIn: (typeof Provider.Type)[];
  channels?: TransferChannel[];
  exporter?: string;
  serverPreferences?: TransferServerPreferences;
  serverIdentity?: { name: string; logo: { path: string; mimeType: string } | null } | undefined;
  sharedSkills?: { slug: string; name: string; path: string; files: string[] }[];
  memberPreferences?:
    | {
        accountId: string;
        server: string | null;
        agents: { agentId: string; level: string }[];
        pins: { kind: string; id: string }[];
      }[]
    | undefined;
}

const decodeManifest = Schema.decodeUnknownResult(Manifest);
const decodeAgent = Schema.decodeUnknownResult(Agent);
const decodeSettings = Schema.decodeUnknownResult(Settings);
const decodeChannel = Schema.decodeUnknownResult(Channel);

export function decodeTransferManifest(bytes: Uint8Array): { manifest: TransferManifest; warnings: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(sourceText("error.import.transferNotFile"));
  }
  const decoded = decodeManifest(value);
  if (Result.isFailure(decoded)) throw new Error(sourceText("error.import.transferNotFile"));
  const file = decoded.success;
  if (file.version !== INSTANCE_TRANSFER_VERSION) throw new Error(sourceText("error.import.transferNewer"));

  const warnings: string[] = [];
  const keys = new Set<string>();
  const agents: TransferAgent[] = [];
  for (const [index, item] of file.agents.entries()) {
    const agent = decodeAgent(item);
    if (Result.isFailure(agent) || keys.has(agent.success.key) || !hasSafePaths(agent.success)) {
      warnings.push(sourceText("error.import.transferAgentInvalid", { number: index + 1 }));
      continue;
    }
    keys.add(agent.success.key);
    agents.push(agent.success);
  }
  let settings: TransferSettings | null = null;
  if (file.settings !== null) {
    const result = decodeSettings(file.settings);
    if (Result.isSuccess(result)) settings = result.success;
    else warnings.push(sourceText("error.import.transferSettingsInvalid"));
  }
  if (agents.length === 0 && settings === null && !file.serverPreferences)
    throw new Error(sourceText("error.import.transferEmpty"));
  return {
    manifest: {
      appVersion: file.source.appVersion || "unknown",
      exportedAt:
        file.source.exportedAt && !Number.isNaN(Date.parse(file.source.exportedAt)) ? file.source.exportedAt : null,
      agents,
      settings,
      shared: file.shared,
      signedIn: file.signedIn,
      channels: decodeChannels(file.channels ?? [], keys, warnings),
      exporter: file.exporter ?? null,
      serverPreferences: file.serverPreferences ?? null,
      serverIdentity: file.serverIdentity ?? null,
      sharedSkills: file.sharedSkills ?? [],
      memberPreferences: file.memberPreferences ?? [],
    },
    warnings,
  };
}

function decodeChannels(
  values: readonly unknown[],
  agentKeys: ReadonlySet<string>,
  warnings: string[],
): TransferChannel[] {
  const keys = new Set<string>();
  const channels: TransferChannel[] = [];
  for (const [index, item] of values.entries()) {
    const decoded = decodeChannel(item);
    const channel = Result.isSuccess(decoded) ? decoded.success : null;
    const prefix = channel ? channelPrefix(channel.key) : "";
    if (
      !channel ||
      keys.has(channel.key) ||
      !isAgentImportKey(channel.key) ||
      (channel.image !== null && (!channel.image.startsWith(prefix) || isUnsafeArchivePath(channel.image))) ||
      (channel.messages ?? []).some((path) => !path.startsWith(prefix) || isUnsafeArchivePath(path))
    ) {
      warnings.push(sourceText("error.import.transferChannelInvalid", { number: index + 1 }));
      continue;
    }
    keys.add(channel.key);
    const members = [...new Set(channel.members)].filter((key) => agentKeys.has(key));
    if (members.length === 0) continue;
    channels.push({ ...channel, members, lead: channel.lead && members.includes(channel.lead) ? channel.lead : null });
  }
  return channels;
}

export function channelPrefix(key: string): string {
  return `channels/${key}/`;
}

function hasSafePaths(agent: TransferAgent): boolean {
  const prefix = `agents/${agent.key}/`;
  const paths = [agent.avatar, agent.files, agent.history ?? null, ...agent.skills].filter(
    (path): path is string => path !== null,
  );
  return paths.every((path) => path.startsWith(prefix) && !isUnsafeArchivePath(path));
}

export function agentPrefix(key: string): string {
  return `agents/${key}/`;
}
