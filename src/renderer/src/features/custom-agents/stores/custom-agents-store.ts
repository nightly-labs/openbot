import type {
  CheckCustomAgentInput,
  CustomAgentCheckResult,
  CustomAgentSummary,
  CustomAgentUsage,
  CustomProviderRestart,
  SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import type { CustomAgentsEndpointApi } from "../custom-agents-port";

interface CustomAgentsState {
  agents: CustomAgentSummary[];
  loaded: boolean;
  usage: CustomAgentUsage[];
}

export interface CustomAgentUsageRow {
  id: string;
  name: string;
  text: string;
}

export function createCustomAgentsStore(api: () => CustomAgentsEndpointApi | undefined) {
  const [state, setState] = createStore<CustomAgentsState>({ agents: [], loaded: false, usage: [] });
  let generation = 0;

  function apply(agents: CustomAgentSummary[], from: number): void {
    if (from !== generation) return;
    setState((current) => {
      current.agents = agents;
      current.loaded = true;
    });
  }

  function customAgents(): CustomAgentSummary[] {
    return state.agents;
  }

  function customAgentsLoaded(): boolean {
    return state.loaded;
  }

  async function refreshCustomAgents(): Promise<void> {
    const group = api();
    if (!group) return;
    const from = generation;
    apply(await group.list(), from);
  }

  function resetCustomAgents(): void {
    generation += 1;
    setState((current) => {
      current.agents = [];
      current.loaded = false;
      current.usage = [];
    });
  }

  function customAgentUsage(): CustomAgentUsageRow[] {
    return state.agents.flatMap((agent) => {
      const answer = agent.usagePrompt ? state.usage.find((usage) => usage.id === agent.id) : undefined;
      return answer ? [{ id: agent.id, name: agent.name, text: answer.text }] : [];
    });
  }

  async function refreshCustomAgentUsage(): Promise<void> {
    const from = generation;
    const usage = await api()?.usage?.();
    if (!usage || from !== generation) return;
    setState((current) => {
      current.usage = usage;
    });
  }

  async function saveCustomAgent(input: SaveCustomAgentInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const from = generation;
    const result = await group.save(input);
    apply(result.agents, from);
    return result.restart;
  }

  async function deleteCustomAgent(id: string): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.removeUnavailable"));
    const from = generation;
    const result = await group.delete({ id });
    apply(result.agents, from);
    return result.restart;
  }

  async function checkCustomAgent(input: CheckCustomAgentInput): Promise<CustomAgentCheckResult> {
    const check = api()?.check;
    if (!check) throw new Error(currentText().t("customProvider.saveUnavailable"));
    return check(input);
  }

  return {
    customAgents,
    customAgentsLoaded,
    refreshCustomAgents,
    resetCustomAgents,
    customAgentUsage,
    refreshCustomAgentUsage,
    saveCustomAgent,
    deleteCustomAgent,
    checkCustomAgent,
  };
}
