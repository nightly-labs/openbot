// The host-wide preferences in an instance transfer file: the choices of Server settings and Agent
// defaults that apply to the whole server. App choices of one computer (theme, language, shortcuts)
// stay with that computer's app and are not here.
//
// The file keeps each preference as the value its store reads. The import checks each one with the
// parser that the Settings screens use and saves it through the same store, so a value that the
// importing app does not accept is left out, and the others are still saved.

import {
  type AgentDefaults,
  type AgentMemoryLimitPreference,
  type BusyMessageModePreference,
  decodeMachineAlertSettings,
  type HostPersonality,
  isClaudeCompactWindowTokens,
  isPromptCacheTtl,
  isServerNotificationLevel,
  isSkillLearningMode,
  type MachineAlertSettings,
  type MemoryReviewPreference,
  type PromptCacheTtl,
  type ServerNotificationLevel,
  type SkillLearningPreference,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import {
  parseAgentDefaults,
  parseAgentMemoryLimitPreference,
  parseBusyMessageModePreference,
  parseMemoryReviewPreference,
} from "./ipc/app-inputs";
import { parseServerPersonality } from "./server-personality-preference-store";
import { parseServerTimezone } from "./server-timezone-preference-store";

/** One preference as the import writes it: read, check, save. */
interface Preference<T> {
  get(): T;
  set(value: T): Effect.Effect<unknown, unknown>;
}

/** The stores of the host-wide preferences. Main wires each to the store its Settings screen writes. */
export interface TransferServerPreferencePort {
  timezone: Preference<string | null>;
  personality: Preference<HostPersonality>;
  busyMessageMode: Preference<BusyMessageModePreference>;
  /** The set also gives the new defaults to the agents that follow them. */
  agentDefaults: Preference<AgentDefaults>;
  memoryLimit: Preference<AgentMemoryLimitPreference>;
  memoryReview: Preference<MemoryReviewPreference>;
  skillLearning: Preference<SkillLearningPreference>;
  promptCacheTtl: Preference<PromptCacheTtl>;
  /** The server notification level of the local owner. */
  ownerNotificationLevel: Preference<ServerNotificationLevel | null>;
  browsingMemory: Preference<{ enabled: boolean }>;
  /** The set sends the provider change event, as the Settings switch does. */
  claudeUserSetup: Preference<boolean>;
  /** The set sends the provider change event, as the Settings field does. */
  claudeCompactWindow: Preference<number | null>;
  /** The member who gets the alerts is left out: member ids belong to one server. Null is the owner. */
  machineAlerts: Preference<MachineAlertSettings>;
  /** The models that an admin turned off, for each provider. */
  modelVisibility: Preference<HiddenModels>;
}

/** The models that an admin turned off, for each provider. */
type HiddenModels = { provider: string; hidden: string[] }[];

/** The preferences as the export writes them: each one as its store reads it. */
export type TransferServerPreferences = {
  [K in keyof TransferServerPreferencePort]?: ReturnType<TransferServerPreferencePort[K]["get"]>;
};

/**
 * The preferences as the import reads them from a file. Each value is checked when it is saved, and a
 * key that this app does not know (from a newer app) is left out.
 */
export const ServerPreferencesInFile = Schema.Record(Schema.String, Schema.Unknown);

function parseTimezone(value: unknown): string | null {
  return value === null ? null : parseServerTimezone(value);
}

function parseSkillLearning(value: unknown): SkillLearningPreference {
  if (!isDynamicRecord(value) || !isSkillLearningMode(value.mode)) throw new Error("Skill learning mode is required.");
  return { mode: value.mode };
}

function parsePromptCacheTtl(value: unknown): PromptCacheTtl {
  if (!isPromptCacheTtl(value)) throw new Error("Prompt cache time is required.");
  return value;
}

function parseNotificationLevel(value: unknown): ServerNotificationLevel | null {
  if (value !== null && !isServerNotificationLevel(value)) throw new Error("Notification level is required.");
  return value;
}

function parseBrowsingMemory(value: unknown): { enabled: boolean } {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Browsing memory is required.");
  return { enabled: value.enabled };
}

function parseBoolean(value: unknown): boolean {
  if (!isBoolean(value)) throw new Error("A switch value is required.");
  return value;
}

function parseCompactWindow(value: unknown): number | null {
  if (!isClaudeCompactWindowTokens(value)) throw new Error("Compact window size is required.");
  return value;
}

/** The thresholds of the file; the alerts go to the owner of this server. */
function parseMachineAlerts(value: unknown): MachineAlertSettings {
  return { ...decodeMachineAlertSettings(value), responsibleMemberId: null };
}

const PROVIDER_LIMIT = 64;
const isBoundedString = (value: unknown, maximum: number): value is string =>
  isString(value) && value.length <= maximum;
const MODEL_LIMIT = 2000;

function parseHiddenModels(value: unknown): HiddenModels {
  if (!Array.isArray(value) || value.length > PROVIDER_LIMIT) throw new Error("Model visibility is required.");
  return value.map((entry) => {
    if (
      !isDynamicRecord(entry) ||
      !isBoundedString(entry.provider, 128) ||
      !Array.isArray(entry.hidden) ||
      entry.hidden.length > MODEL_LIMIT ||
      !entry.hidden.every((id) => isBoundedString(id, 256))
    )
      throw new Error("Model visibility is required.");
    return { provider: entry.provider, hidden: entry.hidden };
  });
}

/** Each key with the parser that the Settings screen of that preference uses, and its store. */
function savers(
  port: TransferServerPreferencePort,
): Record<keyof TransferServerPreferencePort, (value: unknown) => Effect.Effect<unknown, unknown>> {
  return {
    timezone: (value) => save(port.timezone, parseTimezone, value),
    personality: (value) => save(port.personality, parseServerPersonality, value),
    busyMessageMode: (value) => save(port.busyMessageMode, parseBusyMessageModePreference, value),
    agentDefaults: (value) => save(port.agentDefaults, parseAgentDefaults, value),
    memoryLimit: (value) => save(port.memoryLimit, parseAgentMemoryLimitPreference, value),
    memoryReview: (value) => save(port.memoryReview, parseMemoryReviewPreference, value),
    skillLearning: (value) => save(port.skillLearning, parseSkillLearning, value),
    promptCacheTtl: (value) => save(port.promptCacheTtl, parsePromptCacheTtl, value),
    ownerNotificationLevel: (value) => save(port.ownerNotificationLevel, parseNotificationLevel, value),
    browsingMemory: (value) => save(port.browsingMemory, parseBrowsingMemory, value),
    claudeUserSetup: (value) => save(port.claudeUserSetup, parseBoolean, value),
    claudeCompactWindow: (value) => save(port.claudeCompactWindow, parseCompactWindow, value),
    machineAlerts: (value) => save(port.machineAlerts, parseMachineAlerts, value),
    modelVisibility: (value) => save(port.modelVisibility, parseHiddenModels, value),
  };
}

const KEYS: readonly (keyof TransferServerPreferencePort)[] = [
  "timezone",
  "personality",
  "busyMessageMode",
  "agentDefaults",
  "memoryLimit",
  "memoryReview",
  "skillLearning",
  "promptCacheTtl",
  "ownerNotificationLevel",
  "browsingMemory",
  "claudeUserSetup",
  "claudeCompactWindow",
  "machineAlerts",
  "modelVisibility",
];

/** What the export writes. The owner's notification level only when the owner exports. */
export function readServerPreferences(port: TransferServerPreferencePort, owner: boolean): TransferServerPreferences {
  return {
    timezone: port.timezone.get(),
    personality: port.personality.get(),
    busyMessageMode: port.busyMessageMode.get(),
    agentDefaults: port.agentDefaults.get(),
    memoryLimit: port.memoryLimit.get(),
    memoryReview: port.memoryReview.get(),
    skillLearning: port.skillLearning.get(),
    promptCacheTtl: port.promptCacheTtl.get(),
    browsingMemory: port.browsingMemory.get(),
    claudeUserSetup: port.claudeUserSetup.get(),
    claudeCompactWindow: port.claudeCompactWindow.get(),
    machineAlerts: { ...port.machineAlerts.get(), responsibleMemberId: null },
    modelVisibility: port.modelVisibility.get(),
    ...(owner ? { ownerNotificationLevel: port.ownerNotificationLevel.get() } : {}),
  };
}

/**
 * Saves each preference of the file that this app accepts. The owner's notification level only when
 * the owner imports. One warning counts the preferences that were left out.
 */
export const applyServerPreferences = Effect.fn("InstanceTransfer.applyServerPreferences")(function* (
  port: TransferServerPreferencePort,
  preferences: typeof ServerPreferencesInFile.Type,
  owner: boolean,
  warnings: string[],
) {
  let skipped = 0;
  const saveKey = savers(port);
  for (const key of KEYS) {
    if (!(key in preferences) || (key === "ownerNotificationLevel" && !owner)) continue;
    yield* saveKey[key](preferences[key]).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          skipped += 1;
        }),
      ),
    );
  }
  if (skipped > 0) warnings.push(sourceText("error.import.transferServerPreferencesSkipped", { count: skipped }));
});

function save<T>(preference: Preference<T>, parse: (value: unknown) => T, value: unknown) {
  return Effect.try({ try: () => parse(value), catch: (cause) => cause }).pipe(
    Effect.flatMap((parsed) => preference.set(parsed)),
  );
}
