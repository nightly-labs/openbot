import { randomUUID } from "node:crypto";
import { accountUsageCoversModel, isKeyOnlyProvider } from "@openbot/contracts/agent-providers";
import { type AgentSummary, isAgentModel, type UsageTokens, WORKFLOWS_USAGE_ID } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import type { AgentUsage } from "../database/agent-usage";
import type { ProviderSession } from "../database/provider-sessions";
import { getRecord, getString } from "../protocol";

const logger = createOpenBotLogger("usage-collection");
const GROK_USD_TICKS = 10_000_000_000;

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
      // `:codex` counted cache writes as uncached input, so this counter starts again. Its first
      // update records only the last request: the requests before it were counted by `:codex`, or
      // ran in a task before task usage was collected. The last request ran now, also in a session
      // from before collection started. Without the last request, the update is a baseline.
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
        // `modelUsage` counts the whole session, and a resumed session starts from its saved
        // totals. The first report of a resumed process carries `turnModelUsage`: the totals
        // before this turn's requests are the baseline, so the turn books only its own requests.
        previousTokens: turnModels && earlier(tokens, claudeTurnTokens(turnModel ?? null)),
        // Prices this turn from list rates when Claude gives no cost for it.
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
  // A model chosen while the turn runs applies from the next turn, so the turn keeps its own.
  const model = usage.turnModel(agent.id, session.id, turnId) ?? agent.model;
  if (session.provider === "antigravity") {
    // Antigravity 1.4.3 sends the tokens of this prompt only: `_extract_turn_usage` subtracts the
    // session's total at the turn's start, and a restored session starts from its saved total. So
    // each prompt is its own counter, also when a delivery that hit a limit runs again with the same
    // turn ID. Gemini bills thinking as output, and Antigravity sends it apart.
    const tokens = acpTokens(value);
    const thought = count(value.thoughtTokens);
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model,
      counterId: `${session.id}:antigravity:${getString(params, "promptId") ?? turnId}`,
      baseline: false,
      tokens: { ...tokens, output: tokens.output === null ? null : tokens.output + (thought ?? 0) },
    });
    return;
  }
  if (session.provider === "opencode") {
    // OpenCode 1.19 and 2.x send the tokens of this prompt only (`state.usage.turn` starts again for
    // each prompt). `inputTokens` is the uncached input, and each cache and thinking field is left
    // out when it is 0, so a missing one is 0. Reasoning is billed as output. The cost is the
    // session's total, so its own counter keeps the last one. From OpenCode 2.2.0 the cost is what
    // OpenCode Console charged, and the Go subscription charges $0 for a Go model, so a Go turn has
    // no API-equivalent cost.
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
    // Grok CLI 1.0.22 and 1.0.70 send the tokens of this prompt only, with its cost in units of
    // 10^-10 USD. `inputTokens` include the cache reads and writes, and `outputTokens` the reasoning.
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
  // ACP `Usage` is session-cumulative by contract: its fields are documented as "Sum of all token
  // types across session" and "Total input tokens across all turns". So one counter per session,
  // like Codex, and the first report of a session that predates collection is a baseline: it
  // carries tokens spent before analytics existed. Pi also reports its `get_session_stats` cost, a
  // session total at the rates of Pi's model list. Its checkpoint is the token counter, so a session
  // that ran before costs were kept prices its turns only from its second report. A turn that adds 0
  // ran on a model with no rates in that list, not a free turn, so it stays unpriced. A custom agent
  // reports its session total in the `cost` of `usage_update`, which is kept the same way (#4181).
  const sessionCost = session.provider === "pi" || session.provider === "acp" || isKeyOnlyProvider(session.provider);
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

/**
 * Collects the usage of one workflow model or condition step under the reserved Workflows row. The
 * step is its own session, so its counters never meet those of another step on the same process.
 */
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

/**
 * Collects the usage of one background side session under its agent: a memory review, or an
 * `openbot.web_search` turn. The side session has its own id, so its counters never meet those of
 * the agent's turns.
 */
export function sideSessionUsageObserver(
  kind: "memory-review" | "web-search",
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

/**
 * An ACP `Usage`, whose `inputTokens` include the cache reads and writes. The cache fields are
 * optional, and agents leave them out when they are 0 (#4181).
 */
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

/**
 * The turn usage of one `modelUsage` key. Assistant messages name the model without the `[1m]`
 * context suffix of its key, so a suffixed key takes the plain name's usage. When the session also
 * has the plain key, that key takes it, so the turn is counted once.
 */
function claudeTurnModel(turnModels: DynamicRecord, models: DynamicRecord, model: string): DynamicRecord | null {
  const plain = model.replace(/\[1m\]$/, "");
  return getRecord(turnModels, model) ?? (plain !== model && !(plain in models) ? getRecord(turnModels, plain) : null);
}

/** A model with no request in the turn used no tokens in it. */
function claudeTurnTokens(value: DynamicRecord | null): UsageTokens {
  return {
    uncachedInput: count(value?.inputTokens ?? 0),
    cachedInput: count(value?.cacheReadInputTokens ?? 0),
    cacheCreation: count(value?.cacheCreationInputTokens ?? 0),
    output: count(value?.outputTokens ?? 0),
  };
}

/** The totals before `recent`, with each count at least 0. A count is `null` when either value is unknown. */
function earlier(total: UsageTokens, recent: UsageTokens): UsageTokens {
  const result = { ...total };
  for (const key of ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const) {
    const all = total[key];
    const part = recent[key];
    result[key] = all === null || part === null ? null : Math.max(0, all - part);
  }
  return result;
}

/** Codex counts cached input and cache writes inside `inputTokens`. */
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

/** The session totals before the last request, or `null` when a count is unknown. */
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
