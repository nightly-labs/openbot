// The settings of one agent that a transfer carries beside its profile: access, Computer Use, the
// agent defaults, backup models, hidden state, the owner's notification level and pin, and the
// approval choice. A file can come from anywhere, so the import applies only values that keep the
// agent at or below a new agent's permissions. A value that gives more becomes a warning, and the
// user turns it on again. Folders outside the workspace and API keys are paths and secrets of the
// other computer: only their count and names travel.

import {
  type AgentBackupModels,
  type AgentSummary,
  isAgentBackupModels,
  isServerNotificationLevel,
  type ServerNotificationLevel,
  type SetAgentHiddenInput,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";

/** What the file keeps. Each field is optional, and the import checks each one on its own. */
interface TransferPreferences {
  access?: string;
  computerUse?: boolean;
  allowAutomation?: boolean;
  allowNewChat?: boolean;
  quickAcknowledgement?: boolean;
  fastMode?: boolean;
  ultrafast?: boolean;
  backupModels?: AgentBackupModels;
  hidden?: boolean;
  notificationLevel?: ServerNotificationLevel;
  pinned?: boolean;
  autoApprove?: boolean;
  apiKeyNames?: string[];
  folderCount?: number;
}

const API_KEY_NAMES = 64;

/** The owner's choices for agents, and the agent operations that write them. */
export interface TransferPreferencePort {
  notificationLevel(agentId: string): ServerNotificationLevel | null;
  setNotificationLevel(agentId: string, level: ServerNotificationLevel): Effect.Effect<unknown, unknown>;
  pinned(agentId: string): boolean;
  pin(agentId: string): Effect.Effect<unknown, unknown>;
  autoApproves(agentId: string): boolean;
  setAutoApprove(agentId: string, autoApprove: boolean): Effect.Effect<unknown, unknown>;
  apiKeyNames(agentId: string): Effect.Effect<string[], unknown>;
}

export interface TransferPreferenceAgents {
  updateAgent(input: UpdateAgentInput): Effect.Effect<AgentSummary, unknown>;
  setAgentHidden(input: SetAgentHiddenInput): Effect.Effect<unknown, unknown>;
}

export const readPreferences = Effect.fn("InstanceTransfer.readPreferences")(function* (
  agent: AgentSummary,
  port: TransferPreferencePort,
) {
  const level = port.notificationLevel(agent.id);
  const apiKeyNames = yield* port.apiKeyNames(agent.id).pipe(Effect.orElseSucceed((): string[] => []));
  const preferences: TransferPreferences = {
    ...(agent.access ? { access: agent.access } : {}),
    ...(agent.computerUse === undefined ? {} : { computerUse: agent.computerUse }),
    ...(agent.allowAutomation === undefined ? {} : { allowAutomation: agent.allowAutomation }),
    ...(agent.allowNewChat === undefined ? {} : { allowNewChat: agent.allowNewChat }),
    ...(agent.quickAcknowledgement === undefined ? {} : { quickAcknowledgement: agent.quickAcknowledgement }),
    ...(agent.fastMode === undefined ? {} : { fastMode: agent.fastMode }),
    ...(agent.ultrafast ? { ultrafast: true } : {}),
    ...(agent.backupModels ? { backupModels: agent.backupModels } : {}),
    ...(agent.hiddenAt ? { hidden: true } : {}),
    ...(level ? { notificationLevel: level } : {}),
    ...(port.pinned(agent.id) ? { pinned: true } : {}),
    autoApprove: port.autoApproves(agent.id),
    ...(apiKeyNames.length > 0 ? { apiKeyNames: apiKeyNames.slice(0, API_KEY_NAMES) } : {}),
    ...(agent.additionalFolders?.length ? { folderCount: agent.additionalFolders.length } : {}),
  };
  return preferences;
});

/**
 * Applies the settings to an agent the import made. Each step that fails is a warning: the agent
 * stays, with the defaults of a new agent for that setting.
 */
export const applyPreferences = Effect.fn("InstanceTransfer.applyPreferences")(function* (
  agent: AgentSummary,
  value: unknown,
  agents: TransferPreferenceAgents,
  port: TransferPreferencePort | null,
  /** The pins and the notification level are the owner's, so a team member's import leaves them. */
  owner: boolean,
  warnings: string[],
) {
  if (!isDynamicRecord(value)) return;
  const name = agent.name;
  const step = function* (effect: Effect.Effect<unknown, unknown>) {
    const result = yield* Effect.result(effect);
    if (Result.isFailure(result))
      warnings.push(sourceText("error.import.transferAgentSettingSkipped", { name, reason: reason(result.failure) }));
  };

  // Off is never more than a new agent has. On is applied only where a new agent has it on too.
  const update: UpdateAgentInput = { agentId: agent.id };
  if (value.computerUse === false) update.computerUse = false;
  if (typeof value.quickAcknowledgement === "boolean") update.quickAcknowledgement = value.quickAcknowledgement;
  if (typeof value.fastMode === "boolean") update.fastMode = value.fastMode;
  // Ultrafast is a fast mode tier, so it comes only with fast mode on.
  if (value.fastMode === true && value.ultrafast === true) update.ultrafast = true;
  if (value.allowAutomation === false) update.allowAutomation = false;
  if (value.allowAutomation === true) warnings.push(sourceText("error.import.transferLocalScripts", { name }));
  if (value.allowNewChat === false) update.allowNewChat = false;
  if (value.allowNewChat === true) warnings.push(sourceText("error.import.transferAgentNewChats", { name }));
  if (isAgentBackupModels(value.backupModels)) update.backupModels = value.backupModels;
  if (Object.keys(update).length > 1) yield* step(agents.updateAgent(update));
  // A provider that cannot keep an agent in its workspace refuses this, so it is a step of its own.
  if (value.access === "workspace") yield* step(agents.updateAgent({ agentId: agent.id, access: "workspace" }));
  if (value.hidden === true) yield* step(agents.setAgentHidden({ agentId: agent.id, hidden: true }));

  if (port && owner) {
    if (isServerNotificationLevel(value.notificationLevel))
      yield* step(port.setNotificationLevel(agent.id, value.notificationLevel));
    if (value.pinned === true) yield* step(port.pin(agent.id));
  }
  // The approval rule belongs to the server, as for an admin in agent settings.
  if (port && value.autoApprove === false && port.autoApproves(agent.id))
    yield* step(port.setAutoApprove(agent.id, false));
  // Only when this computer asks first: its default can already allow the agent.
  if (value.autoApprove === true && !port?.autoApproves(agent.id))
    warnings.push(sourceText("error.import.transferAlwaysAllow", { name }));

  const names = Array.isArray(value.apiKeyNames)
    ? value.apiKeyNames.filter((item): item is string => typeof item === "string").slice(0, API_KEY_NAMES)
    : [];
  if (names.length > 0) warnings.push(sourceText("error.import.transferAgentEnv", { name, names: names.join(", ") }));
  if (typeof value.folderCount === "number" && Number.isSafeInteger(value.folderCount) && value.folderCount > 0)
    warnings.push(sourceText("error.import.transferFolders", { name, number: value.folderCount }));
});

/** Why one step of an import did not happen, for its warning. */
export function reason(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return cause instanceof Error ? cause.message.slice(0, 500) : sourceText("error.import.transferStepFailed");
}
