import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result } from "effect";
import { z } from "zod";
import type { DynamicToolCallParams } from "../protocol";
import type { ToolApprovalDecision } from "./attention-registry";
import { profileToolErrorMessage } from "./profile-tools";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "./routine-tools";
import { ToolOperationFailed } from "./tool-operation";

const logger = createOpenBotLogger("delete-agent-tool");

const DELETE_AGENT_LIMIT = 20;

export const deleteAgentToolSchema = z.strictObject({
  agentIds: z
    .array(z.string().trim().min(1).max(INPUT_LIMITS.identifier))
    .min(1)
    .max(DELETE_AGENT_LIMIT)
    .refine((ids) => new Set(ids).size === ids.length, "Pass each agent id once.")
    .describe("Agent ids from list_agents, not yours."),
});

export interface DeleteAgentToolOptions {
  listAgents(): AgentSummary[];
  ensureDeletable(agentId: string): Effect.Effect<void, ToolOperationFailed>;
  deleteAgent(agentId: string): Effect.Effect<void, ToolOperationFailed>;
  requestedByPerson: boolean;
  approve(reason: string): Effect.Effect<ToolApprovalDecision, ToolOperationFailed>;
  redactMcp(text: string): string;
}

type AgentResult =
  | { agentId: string; name: string; ok: true }
  | { agentId: string; name: string; ok: false; error: string };

function cardLabel(agent: AgentSummary, agents: readonly AgentSummary[]): string {
  const shared = agents.some((other) => other.id !== agent.id && other.name === agent.name);
  return shared ? `${agent.name} (${agent.id})` : agent.name;
}

export const handleDeleteAgentTool = Effect.fn("DeleteAgentTool.handle")(
  function* (
    params: DynamicToolCallParams,
    senderAgentId: string,
    options: DeleteAgentToolOptions,
  ): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
    const { agentIds } = deleteAgentToolSchema.parse(params.arguments, { reportInput: true });
    if (agentIds.includes(senderAgentId))
      return openBotToolFailure(
        "You cannot delete yourself. Remove your id and retry for the others. To delete you, the user opens your menu in the sidebar and selects Delete agent.",
      );
    if (!options.requestedByPerson)
      return openBotToolFailure(
        "Only a person's message, in your OpenBot chat or a thread they opened, can delete an agent. Do not retry in this turn: tell the user to send the request there as a new message, or to delete the agent from its menu in the sidebar.",
      );
    const agents = options.listAgents();
    const targets = agentIds.map((agentId) => {
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error(sourceText("error.agent.unknown", { id: agentId }));
      return agent;
    });
    const busy: { agentId: string; name: string; error: string }[] = [];
    for (const agent of targets) {
      const deletable = yield* Effect.result(options.ensureDeletable(agent.id));
      if (Result.isFailure(deletable))
        busy.push({
          agentId: agent.id,
          name: agent.name,
          error: options.redactMcp(profileToolErrorMessage(deletable.failure.cause)),
        });
    }
    if (busy.length > 0)
      return openBotToolFailure(
        `No agent was deleted, and no card was shown. These agents cannot be deleted now: ${JSON.stringify(busy)}. Tell the user, or retry without them.`,
      );

    const decision = yield* options.approve(
      sourceText("status.agent.deleteAgents", { agents: targets.map((agent) => cardLabel(agent, agents)).join(", ") }),
    );
    if (decision === "cancel")
      return openBotToolResult({ status: "cancelled", next: "Nobody answered the card, so no agent was deleted." });
    if (decision !== "accept")
      return openBotToolResult({
        status: "declined",
        next: "The user selected Deny, so no agent was deleted. Do not delete them another way, and do not ask again for this request.",
      });

    const results: AgentResult[] = [];
    for (const agent of targets) {
      const deleted = yield* Effect.result(options.deleteAgent(agent.id));
      if (Result.isSuccess(deleted)) {
        results.push({ agentId: agent.id, name: agent.name, ok: true });
        continue;
      }
      const error = options.redactMcp(profileToolErrorMessage(deleted.failure.cause));
      logger.warn("An agent in delete_agent was not deleted.", { agentId: agent.id, error });
      results.push({ agentId: agent.id, name: agent.name, ok: false, error });
    }
    const count = results.filter((result) => result.ok).length;
    return openBotToolResult({
      status: "deleted",
      deleted: count,
      failed: results.length - count,
      results,
      ...(count < results.length
        ? {
            next: "Tell the user which agents were not deleted, and why. Do not delete their folders or files another way.",
          }
        : {}),
    });
  },
  Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
);
