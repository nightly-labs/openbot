import { type AgentSummary, agentComputerUseEnabled, workspaceAccessEnforced } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import type { DynamicToolCallParams } from "../protocol";
import { requestedRuntime, requestedToolModel } from "./model-tools";
import type { OpenBotToolRouterHooks } from "./openbot-tool-router";
import {
  profileToolErrorMessage,
  restrictionInput,
  updateAgentsToolSchema,
  widensAgentSettings,
} from "./profile-tools";
import { type OpenBotToolResponse, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed, toolStep } from "./tool-operation";

const logger = createOpenBotLogger("update-agents-tool");

/** The settings of one changed agent. Instructions are left out, so a result for many agents stays small. */
function agentSettings(agent: AgentSummary) {
  return {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    // A runtime change during work applies before the next turn.
    ...(agent.pendingRuntime ? { pendingRuntime: agent.pendingRuntime } : {}),
    access: workspaceAccessEnforced(agent) ? "workspace" : "full",
    computerUse: agentComputerUseEnabled(agent),
    notifications: agent.notifications,
  };
}

type AgentResult =
  | ({ agentId: string; ok: true } & ReturnType<typeof agentSettings>)
  | { agentId: string; ok: false; error: string };

/**
 * `update_agents`: the settings of `update_profile` that a coordinator sets on many agents at once.
 * Each agent gets the same checks and its own write, in order, so a failure for one agent leaves the
 * others to go on and the result names it.
 */
export const handleUpdateAgentsTool = Effect.fn("UpdateAgentsTool.handle")(
  function* (
    params: DynamicToolCallParams,
    senderAgentId: string,
    hooks: Pick<OpenBotToolRouterHooks, "listAgents" | "listModels" | "updateAgent" | "redactMcp">,
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
    const models = hooks.listModels();
    // A provider or model that is not listed is wrong for every agent, so the whole call fails once.
    // An effort alone depends on each agent's model and is checked per agent.
    if (provider !== undefined || model !== undefined) requestedToolModel(runtimeRequest, models);
    const failed = (agentId: string, message: string): AgentResult => ({ agentId, ok: false, error: message });
    const failure = (agentId: string, cause: unknown) =>
      Effect.sync(() => {
        const message = hooks.redactMcp(profileToolErrorMessage(cause));
        logger.warn("An agent in update_agents was not updated.", { agentId, error: message });
        return failed(agentId, message);
      });

    const results = yield* Effect.forEach(agentIds, (agentId) =>
      Effect.gen(function* () {
        const target = hooks.listAgents().find((agent) => agent.id === agentId);
        if (!target) return failed(agentId, sourceText("error.agent.unknown", { id: agentId }));
        if (widensAgentSettings(target, access, computerUse)) {
          return failed(agentId, sourceText("error.agent.onlyUserWidensSettings"));
        }
        const runtime = yield* toolStep(() => requestedRuntime(target, runtimeRequest, models));
        const updated = yield* hooks.updateAgent(
          {
            agentId,
            ...(notifications === undefined ? {} : { notifications }),
            ...runtime,
            ...restrictionInput(access, computerUse),
          },
          senderAgentId,
        );
        return { agentId, ok: true, ...agentSettings(updated) } satisfies AgentResult;
      }).pipe(
        Effect.catch((error) => failure(agentId, error.cause)),
        Effect.catchDefect((defect) => failure(agentId, defect)),
        // A stop between two agents ends the call; the write of one agent is never cut in half.
        Effect.uninterruptible,
      ),
    );
    const updatedCount = results.filter((result) => result.ok).length;
    return openBotToolResult({ updated: updatedCount, failed: results.length - updatedCount, results });
  },
  Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
);
