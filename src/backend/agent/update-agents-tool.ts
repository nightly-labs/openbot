import {
  AGENT_PROVIDERS,
  type AgentModelOption,
  type AgentSummary,
  agentComputerUseEnabled,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import type { DynamicToolCallParams } from "../protocol";
import { agentReasoningEffort, requestedRuntime, requestedToolModel, requireRunnableChange } from "./model-tools";
import type { OpenBotToolRouterHooks } from "./openbot-tool-router";
import {
  profileToolErrorMessage,
  restrictionInput,
  updateAgentsToolSchema,
  widensAgentSettings,
} from "./profile-tools";
import { type OpenBotToolResponse, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep } from "./tool-operation";
import { unknownAgentMessage } from "./unknown-agent";

const logger = createOpenBotLogger("update-agents-tool");

function agentSettings(agent: AgentSummary, models: AgentModelOption[]) {
  return {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    ...agentReasoningEffort(agent, models),
    ...(agent.pendingRuntime ? { pendingRuntime: agent.pendingRuntime } : {}),
    access: workspaceAccessEnforced(agent) ? "workspace" : "full",
    computerUse: agentComputerUseEnabled(agent),
    notifications: agent.notifications,
  };
}

type AgentResult =
  | ({ agentId: string; ok: true } & ReturnType<typeof agentSettings>)
  | { agentId: string; ok: false; error: string };

export const handleUpdateAgentsTool = Effect.fn("UpdateAgentsTool.handle")(
  function* (
    params: DynamicToolCallParams,
    senderAgentId: string,
    hooks: Pick<
      OpenBotToolRouterHooks,
      | "listAgents"
      | "listModels"
      | "agentModels"
      | "providerAccounts"
      | "providerStatuses"
      | "updateAgent"
      | "redactMcp"
    >,
  ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
    const { agentIds, provider, model, reasoningEffort, access, computerUse, notifications } =
      updateAgentsToolSchema.parse(params.arguments, { reportInput: true });
    const runtimeRequest = { provider, model, reasoningEffort };
    if ([provider, model, reasoningEffort, access, computerUse, notifications].every((value) => value === undefined)) {
      throw new Error("At least one setting is required.");
    }
    if (!hooks.listAgents().some((agent) => agent.id === senderAgentId)) {
      throw new Error("The calling agent no longer exists.");
    }
    if (provider !== undefined || model !== undefined) {
      const accountOnly = AGENT_PROVIDERS.flatMap((id) =>
        (hooks.providerAccounts(id) ?? []).flatMap((account) => account.models ?? []),
      );
      requestedToolModel(runtimeRequest, [...hooks.listModels(), ...accountOnly]);
    }
    const failed = (agentId: string, message: string): AgentResult => ({ agentId, ok: false, error: message });
    const failure = (agentId: string, cause: unknown) =>
      Effect.sync(() => {
        const message = hooks.redactMcp(profileToolErrorMessage(cause));
        logger.warn("An agent in update_agents was not updated.", { agentId, error: message });
        return failed(agentId, message);
      });

    const results = yield* Effect.forEach(agentIds, (agentId) =>
      Effect.gen(function* () {
        const agents = hooks.listAgents();
        const target = agents.find((agent) => agent.id === agentId);
        if (!target) return failed(agentId, unknownAgentMessage(agentId, agents));
        if (widensAgentSettings(target, access, computerUse)) {
          return failed(agentId, sourceText("error.agent.onlyUserWidensSettings"));
        }
        const ownProvider = provider ?? target.provider;
        const models = hooks.agentModels({
          provider: ownProvider,
          providerAccountId: ownProvider === target.provider ? target.providerAccountId : undefined,
        });
        const runtime = yield* toolStep(() => requestedRuntime(target, runtimeRequest, models));
        yield* toolStep(() => requireRunnableChange(target, runtime, hooks.providerStatuses()));
        const updated = yield* hooks.updateAgent(
          {
            agentId,
            ...(notifications === undefined ? {} : { notifications }),
            ...runtime,
            ...restrictionInput(access, computerUse),
          },
          senderAgentId,
        );
        const updatedModels = hooks.agentModels({
          provider: updated.provider,
          providerAccountId: updated.providerAccountId,
        });
        return { agentId, ok: true, ...agentSettings(updated, updatedModels) } satisfies AgentResult;
      }).pipe(
        Effect.catch((error) => failure(agentId, error.cause)),
        Effect.catchDefect((defect) => failure(agentId, defect)),
        Effect.uninterruptible,
      ),
    );
    const updatedCount = results.filter((result) => result.ok).length;
    return openBotToolResult({ updated: updatedCount, failed: results.length - updatedCount, results });
  },
  Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
);
