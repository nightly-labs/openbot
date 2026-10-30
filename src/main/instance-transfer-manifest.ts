// The `openbot-transfer.json` manifest at the root of an instance transfer file. OpenBot writes it
// on one computer and reads it on another, so the format is a contract between app versions: add
// optional fields only, and a change of meaning needs a new `version`. The format is described in
// `docs/architecture/instance-transfer.md`.
//
// A file with an invalid structure is refused. One invalid agent is reported and the others are
// still offered, and invalid settings are left out with a warning.

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
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Result, Schema } from "effect";
import { isUnsafeArchivePath } from "./skill-package";

export const INSTANCE_TRANSFER_MANIFEST = "openbot-transfer.json";
export const INSTANCE_TRANSFER_FORMAT = "openbot-instance-transfer";
export const INSTANCE_TRANSFER_VERSION = 1;
/** Where the files of `~/OpenBot/Shared` are in the archive. */
export const SHARED_FOLDER = "shared";

const text = (limit: number) => Schema.String.check(Schema.isMaxLength(limit));
const name = (limit: number) => text(limit).check(Schema.isMinLength(1));
const guarded = <T>(is: (value: unknown) => value is T) => Schema.declare(is);
const Key = guarded(isAgentImportKey);
const Provider = guarded(isAgentProvider);

const Routine = Schema.Struct({
  /** The routine id on the computer that made the file. Routine flows name routines by it. */
  key: name(INPUT_LIMITS.identifier),
  name: name(INPUT_LIMITS.routineName),
  instruction: name(INPUT_LIMITS.routineInstruction),
  active: Schema.Boolean,
  timezone: text(64),
  schedule: guarded(isRoutineSchedule),
  limitPolicy: Schema.optionalKey(Schema.Literals(ROUTINE_LIMIT_POLICIES)),
  missedPolicy: Schema.optionalKey(Schema.Literals(ROUTINE_MISSED_POLICIES)),
});

const Memory = Schema.Struct({
  text: name(INPUT_LIMITS.agentMemoryText),
  /** Only a choice the user made is kept; the rest is chosen again on import. */
  inclusion: Schema.optionalKey(Schema.Literals(["essential", "searchable"])),
});

const Agent = Schema.Struct({
  key: Key,
  name: name(INPUT_LIMITS.agentName),
  title: text(INPUT_LIMITS.agentTitle),
  description: text(INPUT_LIMITS.agentDescription),
  avatarSeed: text(128),
  avatarHue: Schema.NullOr(guarded(isAvatarHue)),
  /** An archive path inside `agents/<key>/`, checked below. */
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
  /**
   * Routines with a `once` schedule. They are not in `routines`: an app with no one-time schedule
   * refuses an agent with one there, but it ignores this field and keeps the agent.
   */
  oneTimeRoutines: Schema.optionalKey(Schema.Array(Routine).check(Schema.isMaxLength(INPUT_LIMITS.agentRoutines))),
  memories: Schema.Array(Memory).check(Schema.isMaxLength(512)),
});

const Settings = Schema.Struct({
  /** Every environment and header value is empty: only the names travel. */
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
          /**
           * Added after version 1 shipped. An older app ignores it and uses OpenCode's default. The import
           * drops a value out of range, so that a newer limit cannot refuse the whole Settings section.
           */
          contextWindow: Schema.optionalKey(Schema.Number),
        }),
      ).check(Schema.isMaxLength(256)),
      /** The provider had a saved key. The key itself is never in the file. */
      needsApiKey: Schema.Boolean,
      /**
       * Added after version 1 shipped, and only for an endpoint that runs on Pi. An older app ignores
       * it and runs the endpoint on OpenCode. The import drops an unknown value, so that a harness a
       * newer app adds cannot refuse the whole Settings section.
       */
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
  /** MCP servers, providers and custom agents whose argument or URL values the export removed. */
  cleared: Schema.optionalKey(Schema.Array(name(128)).check(Schema.isMaxLength(128))),
});

const Manifest = Schema.Struct({
  format: Schema.Literal(INSTANCE_TRANSFER_FORMAT),
  version: Schema.Number,
  source: Schema.Struct({ appVersion: text(64), exportedAt: Schema.NullOr(text(64)) }),
  agents: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(INPUT_LIMITS.agents)),
  settings: Schema.NullOr(Schema.Unknown),
  shared: Schema.NullOr(Schema.Literal(SHARED_FOLDER)),
  /** Providers that were signed in on the computer that made the file. Never a token. */
  signedIn: Schema.Array(Provider).check(Schema.isMaxLength(32)),
});

export type TransferAgent = typeof Agent.Type;
export type TransferSettings = typeof Settings.Type;

export interface TransferManifest {
  appVersion: string;
  exportedAt: string | null;
  agents: TransferAgent[];
  settings: TransferSettings | null;
  shared: string | null;
  signedIn: readonly (typeof Provider.Type)[];
}

/** What the export writes. The same shape that `decodeTransferManifest` reads. */
export interface TransferManifestFile {
  format: typeof INSTANCE_TRANSFER_FORMAT;
  version: typeof INSTANCE_TRANSFER_VERSION;
  source: { appVersion: string; exportedAt: string };
  agents: TransferAgent[];
  settings: TransferSettings | null;
  shared: typeof SHARED_FOLDER | null;
  signedIn: (typeof Provider.Type)[];
}

const decodeManifest = Schema.decodeUnknownResult(Manifest);
const decodeAgent = Schema.decodeUnknownResult(Agent);
const decodeSettings = Schema.decodeUnknownResult(Settings);

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
  if (agents.length === 0 && settings === null) throw new Error(sourceText("error.import.transferEmpty"));
  return {
    manifest: {
      appVersion: file.source.appVersion || "unknown",
      exportedAt:
        file.source.exportedAt && !Number.isNaN(Date.parse(file.source.exportedAt)) ? file.source.exportedAt : null,
      agents,
      settings,
      shared: file.shared,
      signedIn: file.signedIn,
    },
    warnings,
  };
}

/** Every path an agent names is inside its own `agents/<key>/` folder. */
function hasSafePaths(agent: TransferAgent): boolean {
  const prefix = `agents/${agent.key}/`;
  const paths = [agent.avatar, agent.files, ...agent.skills].filter((path): path is string => path !== null);
  return paths.every((path) => path.startsWith(prefix) && !isUnsafeArchivePath(path));
}

export function agentPrefix(key: string): string {
  return `agents/${key}/`;
}
