import {
  AGENT_REASONING_EFFORTS,
  type AgentModelOption,
  type AgentSummary,
  defaultProviderModel,
} from "@openbot/contracts/ipc";
import { inputPrice } from "./usage-pricing";

/**
 * The model of work that runs beside an agent's turns, such as a memory review or a channel
 * summary: the provider's default model when its known price is lower than the agent's model, so an
 * agent on a large model does this work at the small model's price. A model with no known price
 * stays as it is. Null when the agent's own model is not available.
 */
export function backgroundModel(agent: AgentSummary, models: readonly AgentModelOption[]): AgentModelOption | null {
  const listed = (id: string) => models.find((model) => model.provider === agent.provider && model.id === id);
  const own = listed(agent.model);
  if (!own) return null;
  const smaller = listed(defaultProviderModel(agent.provider));
  if (!smaller || smaller.id === own.id) return own;
  const ownPrice = inputPrice(agent.provider, own.id);
  const smallerPrice = inputPrice(agent.provider, smaller.id);
  return ownPrice !== null && smallerPrice !== null && smallerPrice < ownPrice ? smaller : own;
}

/**
 * The model of a background call, such as a memory review, a channel summary or a profile draft,
 * at the least reasoning that it takes from `minimal` up. The answer is short structured text, and
 * the effort of the agent's turns spent 0.5k to 3k output tokens on it. `none` is not used: a
 * model with no reasoning at all can miss the requested shape. A model with no reasoning setting
 * stays as it is.
 */
export function withBackgroundEffort(model: AgentModelOption): AgentModelOption {
  if (model.reasoningEffortConfigurable === false) return model;
  const effort = AGENT_REASONING_EFFORTS.find(
    (candidate) => candidate !== "none" && model.supportedReasoningEfforts.includes(candidate),
  );
  return effort ? { ...model, defaultReasoningEffort: effort } : model;
}
