import {
  type AgentAdminSettings,
  type AgentSummary,
  agentAutoApprovalEnabled,
  DEFAULT_AGENT_ACCESS,
  type UpdateAgentAdminSettingsInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import type { AgentService } from "../backend/agent-service";
import { causeHelpers } from "../backend/effect-boundary";
import type { ApprovalAutomation } from "./approval-automation-store";

export interface AgentAdminSettingsDependencies {
  agents: Pick<AgentService, "listAgents" | "updateAgent">;
  approvalAutomation: Pick<ApprovalAutomation, "current" | "set">;
}

export interface AgentAdminSettingsService {
  read(agentId: string): AgentAdminSettings;
  update(input: UpdateAgentAdminSettingsInput): Effect.Effect<AgentAdminSettings, AgentSettingsFailure>;
}

export class AgentNotFoundError extends Error {}

export function createAgentAdminSettings({
  agents,
  approvalAutomation,
}: AgentAdminSettingsDependencies): AgentAdminSettingsService {
  function requireAgent(agentId: string): AgentSummary {
    const agent = agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    return agent;
  }
  function settings(agent: AgentSummary): AgentAdminSettings {
    const preference = approvalAutomation.current();
    return {
      access: agent.access ?? DEFAULT_AGENT_ACCESS,
      autoApprove: agentAutoApprovalEnabled(preference, agent.id),
      autoApproveLocked: false,
    };
  }
  const writes = Semaphore.makeUnsafe(1);
  return {
    read: (agentId) => settings(requireAgent(agentId)),
    update(input) {
      return update(input);
    },
  };
  function update({ agentId, access, autoApprove }: UpdateAgentAdminSettingsInput) {
    return Effect.fn("AgentAdminSettings.update")(function* () {
      let agent = yield* Effect.try({
        try: () => requireAgent(agentId),
        catch: (cause) => new AgentSettingsFailure({ cause }),
      });
      const writeAccess = Effect.fn("AgentAdminSettings.writeAccess")(function* () {
        if (access !== undefined) agent = yield* agents.updateAgent({ agentId, access }).pipe(toAgentSettingsFailure);
      });
      const writeGrant = Effect.fn("AgentAdminSettings.writeGrant")(function* () {
        if (autoApprove !== undefined)
          yield* approvalAutomation.set({ agentId, autoApprove }).pipe(toAgentSettingsFailure);
      });
      if (access === "workspace") {
        yield* writeAccess();
        yield* writeGrant();
      } else {
        yield* writeGrant();
        yield* writeAccess();
      }
      return settings(agent);
    })().pipe(writes.withPermit, Effect.uninterruptible);
  }
}

class AgentSettingsFailure extends Schema.TaggedError<AgentSettingsFailure>()("AgentSettingsFailure", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toAgentSettingsFailure } = causeHelpers(AgentSettingsFailure);
