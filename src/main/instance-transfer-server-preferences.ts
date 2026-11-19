import {
  type AgentDefaults,
  type AgentMemoryLimitPreference,
  type BusyMessageModePreference,
  decodeMachineAlertSettings,
  type HostPersonality,
  type HostTurnLimitsInput,
  isClaudeCompactWindowTokens,
  isPromptCacheTtl,
  isServerNotificationLevel,
  isSkillLearningMode,
  type MachineAlertSettings,
  type MemoryReviewPreference,
  type PromptCacheTtl,
  parseHostTurnLimitsInput,
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

interface Preference<T> {
  get(): T;
  set(value: T): Effect.Effect<unknown, unknown>;
}

export interface TransferServerPreferencePort {
  timezone: Preference<string | null>;
  personality: Preference<HostPersonality>;
  busyMessageMode: Preference<BusyMessageModePreference>;
  agentDefaults: Preference<AgentDefaults>;
  memoryLimit: Preference<AgentMemoryLimitPreference>;
  memoryReview: Preference<MemoryReviewPreference>;
  skillLearning: Preference<SkillLearningPreference>;
  promptCacheTtl: Preference<PromptCacheTtl>;
  ownerNotificationLevel: Preference<ServerNotificationLevel | null>;
  browsingMemory: Preference<{ enabled: boolean }>;
  claudeUserSetup: Preference<boolean>;
  claudeCompactWindow: Preference<number | null>;
  machineAlerts: Preference<MachineAlertSettings>;
  modelVisibility: Preference<HiddenModels>;
  turnLimits: Preference<HostTurnLimitsInput>;
}

type HiddenModels = { provider: string; hidden: string[] }[];

export type TransferServerPreferences = {
  [K in keyof TransferServerPreferencePort]?: ReturnType<TransferServerPreferencePort[K]["get"]>;
};

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
    turnLimits: (value) => save(port.turnLimits, parseHostTurnLimitsInput, value),
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
  "turnLimits",
];

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
    turnLimits: port.turnLimits.get(),
    ...(owner ? { ownerNotificationLevel: port.ownerNotificationLevel.get() } : {}),
  };
}

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
