import { Effect, Schema } from "effect";
// Computer Use, local scripts and the busy-message mode of one agent, as this computer holds them.
// The `agent-host-settings-v1` host routes use this, and they write through `AgentService.updateAgent`,
// the writer of the local window, so a remote admin changes the same state.

import {
  type AgentHostSettings,
  type AgentSummary,
  agentAutomationAllowed,
  agentComputerUseEnabled,
  type UpdateAgentHostSettingsInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentService } from "../backend/agent-service";
import { causeHelpers } from "../backend/effect-boundary";
import { AgentNotFoundError } from "./agent-admin-settings";
import type { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";

export interface AgentHostSettingsDependencies {
  agents: Pick<AgentService, "listAgents" | "updateAgent">;
  busyMessageMode: Pick<BusyMessageModePreferenceStore, "get">;
}

export interface AgentHostSettingsService {
  read(agentId: string): AgentHostSettings;
  update(input: UpdateAgentHostSettingsInput): Effect.Effect<AgentHostSettings, AgentHostSettingsFailure>;
}

export function createAgentHostSettings({
  agents,
  busyMessageMode,
}: AgentHostSettingsDependencies): AgentHostSettingsService {
  function requireAgent(agentId: string): AgentSummary {
    const agent = agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    return agent;
  }
  function settings(agent: AgentSummary): AgentHostSettings {
    return {
      computerUse: agentComputerUseEnabled(agent),
      allowAutomation: agentAutomationAllowed(agent),
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
  return {
    read: (agentId) => settings(requireAgent(agentId)),
    update: (input) => update(input).pipe(Effect.uninterruptible),
  };
}

class AgentHostSettingsFailure extends Schema.TaggedError<AgentHostSettingsFailure>()("AgentHostSettingsFailure", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toAgentHostSettingsFailure } = causeHelpers(AgentHostSettingsFailure);
