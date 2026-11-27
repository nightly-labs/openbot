import {
  AGENT_REASONING_EFFORTS,
  type AgentModelOption,
  type AgentSummary,
  defaultProviderModel,
} from "@openbot/contracts/ipc";
import { inputPrice } from "./usage-pricing";

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

export function withBackgroundEffort(model: AgentModelOption): AgentModelOption {
  if (model.reasoningEffortConfigurable === false) return model;
  const effort = AGENT_REASONING_EFFORTS.find(
    (candidate) => candidate !== "none" && model.supportedReasoningEfforts.includes(candidate),
  );
  return effort ? { ...model, defaultReasoningEffort: effort } : model;
}
