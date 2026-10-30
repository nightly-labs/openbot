import { Effect, Schema } from "effect";
// Computer Use, local scripts, the busy-message mode, the backup models and the task limit of one
// agent, as this computer holds them. The `agent-host-settings-v1`, `agent-backup-models-v1` and
// `agent-task-limit-v1` host routes use this, and they write through `AgentService.updateAgent`, the
// writer of the local window, so a remote admin changes the same state.

import {
  type AgentBackupModelSettings,
  type AgentHostSettings,
  type AgentSummary,
  type AgentTaskLimitSettings,
  agentAutomationAllowed,
  agentComputerUseEnabled,
  type UpdateAgentBackupModelsInput,
  type UpdateAgentHostSettingsInput,
  type UpdateAgentTaskLimitInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../backend/agent-service";
import { causeHelpers } from "../backend/effect-boundary";
import { AgentNotFoundError } from "./agent-admin-settings";
import type { AgentDefaultsPreferenceStore } from "./agent-defaults-preference-store";
import type { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";

export interface AgentHostSettingsDependencies {
  agents: Pick<AgentService, "listAgents" | "updateAgent">;
  busyMessageMode: Pick<BusyMessageModePreferenceStore, "get">;
  agentDefaults: Pick<AgentDefaultsPreferenceStore, "get">;
}

export interface AgentHostSettingsService {
  read(agentId: string): AgentHostSettings;
  update(input: UpdateAgentHostSettingsInput): Effect.Effect<AgentHostSettings, AgentHostSettingsFailure>;
  readBackupModels(agentId: string): AgentBackupModelSettings;
  updateBackupModels(
    input: UpdateAgentBackupModelsInput,
  ): Effect.Effect<AgentBackupModelSettings, AgentHostSettingsFailure>;
  readTaskLimit(agentId: string): AgentTaskLimitSettings;
  updateTaskLimit(input: UpdateAgentTaskLimitInput): Effect.Effect<AgentTaskLimitSettings, AgentHostSettingsFailure>;
}

export function createAgentHostSettings({
  agents,
  busyMessageMode,
  agentDefaults,
}: AgentHostSettingsDependencies): AgentHostSettingsService {
  function requireAgent(agentId: string): AgentSummary {
    const agent = agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    return agent;
  }
  function settings(agent: AgentSummary): AgentHostSettings {
    return {
      computerUse: agentComputerUseEnabled(agent),
      allowAutomation: agentAutomationAllowed(agent, agentDefaults.get()),
      busyMessageMode: agent.busyMessageMode ?? null,
      defaultBusyMessageMode: busyMessageMode.get().mode,
    };
  }
  const update = Effect.fn("AgentHostSettings.update")(function* ({
    agentId,
    ...changes
  }: UpdateAgentHostSettingsInput) {
    yield* Effect.try({
      try: () => requireAgent(agentId),
      catch: (cause) => new AgentHostSettingsFailure({ cause }),
    });
    const agent = yield* agents.updateAgent({ agentId, ...changes }).pipe(toAgentHostSettingsFailure);
    return settings(agent);
  });
  const backupModels = (agent: AgentSummary): AgentBackupModelSettings => ({
    backupModels: agent.backupModels ?? null,
    usageLimitReturn: agent.usageLimitReturn ?? null,
  });
  const updateBackupModels = Effect.fn("AgentHostSettings.updateBackupModels")(function* ({
    agentId,
    backupModels: next,
  }: UpdateAgentBackupModelsInput) {
    yield* Effect.try({
      try: () => requireAgent(agentId),
      catch: (cause) => new AgentHostSettingsFailure({ cause }),
    });
    const agent = yield* agents.updateAgent({ agentId, backupModels: next }).pipe(toAgentHostSettingsFailure);
    return backupModels(agent);
  });
  const taskLimit = (agent: AgentSummary): AgentTaskLimitSettings => ({ taskLimit: agent.taskLimit ?? null });
  const updateTaskLimit = Effect.fn("AgentHostSettings.updateTaskLimit")(function* ({
    agentId,
    taskLimit: next,
  }: UpdateAgentTaskLimitInput) {
    yield* Effect.try({
      try: () => requireAgent(agentId),
      catch: (cause) => new AgentHostSettingsFailure({ cause }),
    });
    const agent = yield* agents.updateAgent({ agentId, taskLimit: next }).pipe(toAgentHostSettingsFailure);
    return taskLimit(agent);
  });
  return {
    read: (agentId) => settings(requireAgent(agentId)),
    update: (input) => update(input).pipe(Effect.uninterruptible),
    readBackupModels: (agentId) => backupModels(requireAgent(agentId)),
    updateBackupModels: (input) => updateBackupModels(input).pipe(Effect.uninterruptible),
    readTaskLimit: (agentId) => taskLimit(requireAgent(agentId)),
    updateTaskLimit: (input) => updateTaskLimit(input).pipe(Effect.uninterruptible),
  };
}

class AgentHostSettingsFailure extends Schema.TaggedError<AgentHostSettingsFailure>()("AgentHostSettingsFailure", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toAgentHostSettingsFailure } = causeHelpers(AgentHostSettingsFailure);
