import {
  type AgentBackupModelSettings,
  type AgentBuiltinMemorySettings,
  type AgentFastModel,
  type AgentFastModeSettings,
  type AgentHostSettings,
  type AgentNewChatSettings,
  type AgentPlanCardSettings,
  type AgentSpeedSettings,
  type AgentSteeringModel,
  type AgentSummary,
  type AgentTaskLimitSettings,
  agentAutomationAllowed,
  agentComputerUseEnabled,
  agentFastModeSettings,
  agentMemoryEnabled,
  agentNewChatAllowed,
  agentQuickAcknowledgementEnabled,
  agentSpeed,
  type UpdateAgentBackupModelsInput,
  type UpdateAgentBuiltinMemoryInput,
  type UpdateAgentFastModeInput,
  type UpdateAgentHostSettingsInput,
  type UpdateAgentNewChatInput,
  type UpdateAgentPlanCardInput,
  type UpdateAgentSpeedInput,
  type UpdateAgentTaskLimitInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import type { AgentService } from "../backend/agent-service";
import { causeHelpers } from "../backend/effect-boundary";
import { AgentNotFoundError } from "./agent-admin-settings";
import type { AgentDefaultsPreferenceStore } from "./agent-defaults-preference-store";
import type { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";

export interface AgentHostSettingsDependencies {
  agents: Pick<AgentService, "listAgents" | "listModels" | "updateAgent">;
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
  readNewChat(agentId: string): AgentNewChatSettings;
  updateNewChat(input: UpdateAgentNewChatInput): Effect.Effect<AgentNewChatSettings, AgentHostSettingsFailure>;
  readPlanCard(agentId: string): AgentPlanCardSettings;
  updatePlanCard(input: UpdateAgentPlanCardInput): Effect.Effect<AgentPlanCardSettings, AgentHostSettingsFailure>;
  readBuiltinMemory(agentId: string): AgentBuiltinMemorySettings;
  updateBuiltinMemory(
    input: UpdateAgentBuiltinMemoryInput,
  ): Effect.Effect<AgentBuiltinMemorySettings, AgentHostSettingsFailure>;
  readFastMode(agentId: string): AgentFastModeSettings;
  updateFastMode(input: UpdateAgentFastModeInput): Effect.Effect<AgentFastModeSettings, AgentHostSettingsFailure>;
  listFastModels(): AgentFastModel[];
  readSpeed(agentId: string): AgentSpeedSettings;
  updateSpeed(input: UpdateAgentSpeedInput): Effect.Effect<AgentSpeedSettings, AgentHostSettingsFailure>;
  listSpeedModels(): AgentFastModel[];
  listSteeringModels(): AgentSteeringModel[];
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
  const newChat = (agent: AgentSummary): AgentNewChatSettings => ({
    allowNewChat: agentNewChatAllowed(agent, agentDefaults.get()),
  });
  const updateNewChat = Effect.fn("AgentHostSettings.updateNewChat")(function* ({
    agentId,
    allowNewChat,
  }: UpdateAgentNewChatInput) {
    yield* Effect.try({
      try: () => requireAgent(agentId),
      catch: (cause) => new AgentHostSettingsFailure({ cause }),
    });
    const agent = yield* agents.updateAgent({ agentId, allowNewChat }).pipe(toAgentHostSettingsFailure);
    return newChat(agent);
  });
  const planCard = (agent: AgentSummary): AgentPlanCardSettings => ({
    quickAcknowledgement: agentQuickAcknowledgementEnabled(agent, agentDefaults.get()),
  });
  const updatePlanCard = Effect.fn("AgentHostSettings.updatePlanCard")(function* ({
    agentId,
    quickAcknowledgement,
  }: UpdateAgentPlanCardInput) {
    yield* Effect.try({
      try: () => requireAgent(agentId),
      catch: (cause) => new AgentHostSettingsFailure({ cause }),
    });
    const agent = yield* agents.updateAgent({ agentId, quickAcknowledgement }).pipe(toAgentHostSettingsFailure);
    return planCard(agent);
  });
  const builtinMemory = (agent: AgentSummary): AgentBuiltinMemorySettings => ({ memory: agentMemoryEnabled(agent) });
  const updateBuiltinMemory = Effect.fn("AgentHostSettings.updateBuiltinMemory")(function* ({
    agentId,
    memory,
  }: UpdateAgentBuiltinMemoryInput) {
    yield* Effect.try({
      try: () => requireAgent(agentId),
      catch: (cause) => new AgentHostSettingsFailure({ cause }),
    });
    const agent = yield* agents.updateAgent({ agentId, memory }).pipe(toAgentHostSettingsFailure);
    return builtinMemory(agent);
  });
  const fastMode = (agent: AgentSummary): AgentFastModeSettings => ({ fastMode: agent.fastMode ?? null });
  const writeFastMode = Effect.fn("AgentHostSettings.writeFastMode")(function* (
    agentId: string,
    next: boolean,
    ultrafast: boolean,
  ) {
    yield* Effect.try({
      try: () => requireAgent(agentId),
      catch: (cause) => new AgentHostSettingsFailure({ cause }),
    });
    return yield* agents
      .updateAgent({ agentId, fastMode: next, ...(next && ultrafast ? { ultrafast: true } : {}) })
      .pipe(toAgentHostSettingsFailure);
  });
  const updateFastMode = Effect.fn("AgentHostSettings.updateFastMode")(function* ({
    agentId,
    fastMode: next,
    ultrafast,
  }: UpdateAgentFastModeInput) {
    return fastMode(yield* writeFastMode(agentId, next, ultrafast === true));
  });
  const speed = (agent: AgentSummary): AgentSpeedSettings => ({
    speed: agentSpeed({ fastMode: agent.fastMode ?? null, ...(agent.ultrafast ? { ultrafast: true } : {}) }),
  });
  const updateSpeed = Effect.fn("AgentHostSettings.updateSpeed")(function* (input: UpdateAgentSpeedInput) {
    const { fastMode: next, ultrafast } = agentFastModeSettings({ speed: input.speed });
    return speed(yield* writeFastMode(input.agentId, next === true, ultrafast === true));
  });
  return {
    read: (agentId) => settings(requireAgent(agentId)),
    update: (input) => update(input).pipe(Effect.uninterruptible),
    readBackupModels: (agentId) => backupModels(requireAgent(agentId)),
    updateBackupModels: (input) => updateBackupModels(input).pipe(Effect.uninterruptible),
    readTaskLimit: (agentId) => taskLimit(requireAgent(agentId)),
    updateTaskLimit: (input) => updateTaskLimit(input).pipe(Effect.uninterruptible),
    readNewChat: (agentId) => newChat(requireAgent(agentId)),
    updateNewChat: (input) => updateNewChat(input).pipe(Effect.uninterruptible),
    readPlanCard: (agentId) => planCard(requireAgent(agentId)),
    updatePlanCard: (input) => updatePlanCard(input).pipe(Effect.uninterruptible),
    readBuiltinMemory: (agentId) => builtinMemory(requireAgent(agentId)),
    updateBuiltinMemory: (input) => updateBuiltinMemory(input).pipe(Effect.uninterruptible),
    readFastMode: (agentId) => fastMode(requireAgent(agentId)),
    updateFastMode: (input) => updateFastMode(input).pipe(Effect.uninterruptible),
    listFastModels: () =>
      agents
        .listModels()
        .flatMap(({ provider, id, fastServiceTier }) =>
          fastServiceTier && provider !== "claude" ? [{ provider, id, fastServiceTier }] : [],
        ),
    readSpeed: (agentId) => speed(requireAgent(agentId)),
    updateSpeed: (input) => updateSpeed(input).pipe(Effect.uninterruptible),
    listSpeedModels: () =>
      agents
        .listModels()
        .flatMap(({ provider, id, fastServiceTier, ultrafastServiceTier }) =>
          fastServiceTier
            ? [{ provider, id, fastServiceTier, ...(ultrafastServiceTier ? { ultrafastServiceTier } : {}) }]
            : [],
        ),
    listSteeringModels: () =>
      agents.listModels().flatMap(({ provider, id, steersTurns }) => (steersTurns ? [{ provider, id }] : [])),
  };
}

class AgentHostSettingsFailure extends Schema.TaggedError<AgentHostSettingsFailure>()("AgentHostSettingsFailure", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toAgentHostSettingsFailure } = causeHelpers(AgentHostSettingsFailure);
