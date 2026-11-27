import { randomUUID } from "node:crypto";
import { accountUsageCoversModel, isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import { type AgentSummary, isAgentModel, type UsageTokens, WORKFLOWS_USAGE_ID } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import type { AgentUsage } from "../database/agent-usage";
import type { ProviderSession } from "../database/provider-sessions";
import { getRecord, getString } from "../protocol";
import { inputPrice } from "./usage-pricing";

const logger = createOpenBotLogger("usage-collection");
const GROK_USD_TICKS = 10_000_000_000;

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

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
    const tokenUsage = getRecord(params, "tokenUsage");
    const tokens = codexTokens(getRecord(tokenUsage, "total"));
    if (!tokens) return;
    const last = codexTokens(getRecord(tokenUsage, "last"));
    const previousTokens = last && before(tokens, last);
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model: usage.turnModel(agent.id, session.id, turnId) ?? agent.model,
      counterId: `${session.id}:codex:cache-writes`,
      previousTokens,
      lastRequestInputTokens: last && sum(last),
      tokens,
      baseline: turnId === "baseline" || !previousTokens,
    });
    return;
  }
  if (session.provider === "claude") {
    const models = getRecord(params, "modelUsage");
    const counterId = getString(params, "counterId");
    if (!models || !counterId) return;
    const turnModels = getRecord(params, "turnModelUsage");
    for (const [model, value] of Object.entries(models)) {
      if (!isDynamicRecord(value) || !isAgentModel(model)) continue;
      const turnModel = turnModels && claudeTurnModel(turnModels, models, model);
      const tokens = {
        uncachedInput: count(value.inputTokens),
        cachedInput: count(value.cacheReadInputTokens),
        cacheCreation: count(value.cacheCreationInputTokens),
        output: count(value.outputTokens),
      };
      usage.record({
        agentId: agent.id,
        sessionId: session.id,
        turnId,
        provider: session.provider,
        model,
        counterId: `${session.id}:${counterId}:${model}`,
        previousTokens: turnModels && earlier(tokens, claudeTurnTokens(turnModel ?? null)),
        smallestRequestInputTokens: turnModel ? count(turnModel.smallestRequestInputTokens) : null,
        baseline: false,
        tokens,
        reportedCost: value.costBasis === "unknown" || value.costBasis === "managed" ? null : cost(value.costUSD),
      });
    }
    return;
  }
  const value = getRecord(params, "usage");
  if (!value) return;
  const model = usage.turnModel(agent.id, session.id, turnId) ?? agent.model;
  if (session.provider === "antigravity") {
    const output = count(value.outputTokens);
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model,
      counterId: `${session.id}:antigravity:${getString(params, "promptId") ?? turnId}`,
      baseline: false,
      tokens: {
        uncachedInput: count(value.inputTokens),
        cachedInput: count(value.cachedReadTokens ?? 0),
        cacheCreation: count(value.cachedWriteTokens ?? 0),
        output: output === null ? null : output + (count(value.thoughtTokens) ?? 0),
      },
    });
    return;
  }
  if (session.provider === "opencode") {
    const output = count(value.outputTokens);
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model,
      counterId: `${session.id}:opencode:${getString(params, "promptId") ?? turnId}`,
      costCounterId: `${session.id}:opencode:cost`,
      reportedCost: isDynamicRecord(params) && !accountUsageCoversModel("opencode", model) ? cost(params.cost) : null,
      baseline: false,
      tokens: {
        uncachedInput: count(value.inputTokens),
        cachedInput: count(value.cachedReadTokens ?? 0),
        cacheCreation: count(value.cachedWriteTokens ?? 0),
        output: output === null ? null : output + (count(value.thoughtTokens ?? 0) ?? 0),
      },
    });
    return;
  }
  if (session.provider === "grok") {
    const ticks = cost(value.costUsdTicks);
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model,
      counterId: `${session.id}:grok:${getString(params, "promptId") ?? turnId}`,
      baseline: false,
      tokens: acpTokens({ ...value, cachedWriteTokens: value.cacheCreationTokens }),
      reportedCost: ticks === null ? null : ticks / GROK_USD_TICKS,
    });
    return;
  }
  if (session.provider === "acp") {
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model,
      counterId: `${session.id}:acp:${getString(params, "promptId") ?? turnId}`,
      costCounterId: `${session.id}:grok`,
      baseline: false,
      tokens: acpTokens(value),
      reportedCost: isDynamicRecord(params) ? cost(params.cost) : null,
      zeroCostUnpriced: true,
    });
    return;
  }
  const ownPrice = session.provider === "deepseek" && inputPrice(session.provider, model) !== null;
  const sessionCost = !ownPrice && (session.provider === "pi" || isKeyOnlyProvider(session.provider));
  const reportedCost = sessionCost && isDynamicRecord(params) ? cost(params.cost) : null;
  usage.record({
    agentId: agent.id,
    sessionId: session.id,
    turnId,
    provider: session.provider,
    model,
    counterId: `${session.id}:grok`,
    baseline: session.createdAt < usage.collectionStartedAt(),
    tokens: acpTokens(value),
    reportedCost,
    zeroCostUnpriced: sessionCost,
  });
}

export function workflowUsageObserver(
  usage: AgentUsage,
  provider: ProviderSession["provider"],
  model: AgentSummary["model"],
): (notification: { method: string; params?: unknown }) => void {
  const session = { id: `workflow:${randomUUID()}`, provider, createdAt: new Date().toISOString() };
  return ({ method, params }) => {
    try {
      collectProviderUsage(usage, { id: WORKFLOWS_USAGE_ID, model }, session, method, params);
    } catch (error) {
      logger.warn("Could not save the usage of a workflow step.", { provider, error });
    }
  };
}

export function sideSessionUsageObserver(
  kind: "memory-review" | "finish-check" | "web-search" | "voice-summary",
  usage: AgentUsage,
  agentId: string,
  provider: ProviderSession["provider"],
  model: AgentSummary["model"],
): (notification: { method: string; params?: unknown }) => void {
  const session = { id: `${kind}:${randomUUID()}`, provider, createdAt: new Date().toISOString() };
  return ({ method, params }) => {
    try {
      collectProviderUsage(usage, { id: agentId, model }, session, method, params);
    } catch (error) {
      logger.warn("Could not save the usage of a side session.", { kind, provider, error });
    }
  };
}

function acpTokens(value: DynamicRecord): UsageTokens {
  const input = count(value.inputTokens);
  const cached = count(value.cachedReadTokens ?? 0);
  const creation = count(value.cachedWriteTokens ?? 0);
  return {
    uncachedInput:
      input !== null && cached !== null && creation !== null && input >= cached + creation
        ? input - cached - creation
        : null,
    cachedInput: cached,
    cacheCreation: creation,
    output: count(value.outputTokens),
  };
}

function claudeTurnModel(turnModels: DynamicRecord, models: DynamicRecord, model: string): DynamicRecord | null {
  const plain = model.replace(/\[1m\]$/, "");
  return getRecord(turnModels, model) ?? (plain !== model && !(plain in models) ? getRecord(turnModels, plain) : null);
}

function claudeTurnTokens(value: DynamicRecord | null): UsageTokens {
  return {
    uncachedInput: count(value?.inputTokens ?? 0),
    cachedInput: count(value?.cacheReadInputTokens ?? 0),
    cacheCreation: count(value?.cacheCreationInputTokens ?? 0),
    output: count(value?.outputTokens ?? 0),
  };
}

function earlier(total: UsageTokens, recent: UsageTokens): UsageTokens {
  const result = { ...total };
  for (const key of ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const) {
    const all = total[key];
    const part = recent[key];
    result[key] = all === null || part === null ? null : Math.max(0, all - part);
  }
  return result;
}

function codexTokens(breakdown: DynamicRecord | null): UsageTokens | null {
  if (!breakdown) return null;
  const input = count(breakdown.inputTokens);
  const cached = count(breakdown.cachedInputTokens);
  const written = count(breakdown.cacheWriteInputTokens) ?? 0;
  return {
    uncachedInput: input !== null && cached !== null && cached + written <= input ? input - cached - written : null,
    cachedInput: cached,
    cacheCreation: written,
    output: count(breakdown.outputTokens),
  };
}

function before(total: UsageTokens, last: UsageTokens): UsageTokens | null {
  const { uncachedInput, cachedInput, cacheCreation, output } = total;
  if (uncachedInput === null || cachedInput === null || cacheCreation === null || output === null) return null;
  if (last.uncachedInput === null || last.cachedInput === null || last.cacheCreation === null || last.output === null)
    return null;
  const earlier = {
    uncachedInput: uncachedInput - last.uncachedInput,
    cachedInput: cachedInput - last.cachedInput,
    cacheCreation: cacheCreation - last.cacheCreation,
    output: output - last.output,
  };
  return Object.values(earlier).every((value) => value >= 0) ? earlier : null;
}

function sum(tokens: UsageTokens): number | null {
  return tokens.uncachedInput === null || tokens.cachedInput === null || tokens.cacheCreation === null
    ? null
    : tokens.uncachedInput + tokens.cachedInput + tokens.cacheCreation;
}
function cost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
