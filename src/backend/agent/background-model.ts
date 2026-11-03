import { type AgentModelOption, type AgentSummary, defaultProviderModel } from "@openbot/contracts/ipc";
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
