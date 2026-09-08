import { type AgentSummary, isAgentModel, type UsageTokens } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentUsage } from "../database/agent-usage";
import type { ProviderSession } from "../database/provider-sessions";
import { getRecord, getString } from "../protocol";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Translates provider counters at the process boundary, without retaining provider payloads. */
export function collectProviderUsage(
  usage: AgentUsage,
  agent: Pick<AgentSummary, "id" | "model">,
  session: Pick<ProviderSession, "id" | "provider" | "createdAt">,
  method: string,
  params: unknown,
): void {
  if (method === "turn/started") {
    const turnId = getString(getRecord(params, "turn"), "id");
    if (turnId) usage.startTurn(agent.id, session.id, turnId, session.provider, agent.model);
    return;
  }
  if (method === "model/rerouted") {
    const turnId = getString(params, "turnId");
    const model = getString(params, "toModel");
    if (turnId && isAgentModel(model)) usage.reroute(agent.id, session.id, turnId, model);
    return;
  }
  if (method !== "thread/tokenUsage/updated" && method !== "openbot/usage") return;
  const turnId = getString(params, "turnId") ?? "baseline";
  if (session.provider === "codex") {
    const total = getRecord(getRecord(params, "tokenUsage"), "total");
    if (!total) return;
    const input = count(total.inputTokens);
    const cached = count(total.cachedInputTokens);
    const tokens: UsageTokens = {
      uncachedInput: input !== null && cached !== null && cached <= input ? input - cached : null,
      cachedInput: cached,
      cacheCreation: count(total.cacheCreationInputTokens) ?? 0,
      output: count(total.outputTokens),
    };
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model: usage.turnModel(agent.id, session.id, turnId) ?? agent.model,
      counterId: `${session.id}:codex`,
      pricingInputTokens: count(getRecord(getRecord(params, "tokenUsage"), "last")?.inputTokens),
      tokens,
      baseline: session.createdAt < usage.collectionStartedAt() || turnId === "baseline",
    });
    return;
  }
  if (session.provider === "claude") {
    const models = getRecord(params, "modelUsage");
    const counterId = getString(params, "counterId");
    if (!models || !counterId) return;
    for (const [model, value] of Object.entries(models)) {
      if (!isDynamicRecord(value) || !isAgentModel(model)) continue;
      usage.record({
        agentId: agent.id,
        sessionId: session.id,
        turnId,
        provider: session.provider,
        model,
        counterId: `${session.id}:${counterId}:${model}`,
        baseline: false,
        tokens: {
          uncachedInput: count(value.inputTokens),
          cachedInput: count(value.cacheReadInputTokens),
          cacheCreation: count(value.cacheCreationInputTokens),
          output: count(value.outputTokens),
        },
        reportedCost: value.costBasis === "unknown" || value.costBasis === "managed" ? null : cost(value.costUSD),
      });
    }
    return;
  }
  // ACP `Usage` is session-cumulative by contract: its fields are documented as "Sum of all token
  // types across session" and "Total input tokens across all turns". So one counter per session,
  // like Codex, and the first report of a session that predates collection is a baseline: it
  // carries tokens spent before analytics existed.
  const value = getRecord(params, "usage");
  if (!value) return;
  const input = count(value.inputTokens);
  const cached = count(value.cachedReadTokens);
  const creation = count(value.cachedWriteTokens);
  usage.record({
    agentId: agent.id,
    sessionId: session.id,
    turnId,
    provider: session.provider,
    model: agent.model,
    counterId: `${session.id}:grok`,
    baseline: session.createdAt < usage.collectionStartedAt(),
    tokens: {
      uncachedInput:
        input !== null && cached !== null && creation !== null && input >= cached + creation
          ? input - cached - creation
          : null,
      cachedInput: cached,
      cacheCreation: creation,
      output: count(value.outputTokens),
    },
  });
}
function cost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
