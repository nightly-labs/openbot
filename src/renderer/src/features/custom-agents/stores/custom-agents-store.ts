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
  /** False until the first list arrives, so an empty list is not read as "none saved". */
  loaded: boolean;
  /** The last answers to the usage prompts. An agent with no answer is not listed. */
  usage: CustomAgentUsage[];
}

/** The answer of one agent to its usage prompt, with the name that the rail shows. */
export interface CustomAgentUsageRow {
  id: string;
  name: string;
  text: string;
}

/**
 * The user's own ACP agents, as the renderer sees them: the variable names, and never a value.
 *
 * The same shape as the custom providers store: the API is an accessor, an absent group leaves the
 * list empty, and the mutations write the list main returned and re-throw for the button that
 * started them.
 */
export function createCustomAgentsStore(api: () => CustomAgentsEndpointApi | undefined) {
  const [state, setState] = createStore<CustomAgentsState>({ agents: [], loaded: false, usage: [] });
  /** Changes on each `reset`, so an answer of the previous API does not replace the new list. */
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

  /** Empties the list for a new API, such as another server, and drops the answers still in flight. */
  function resetCustomAgents(): void {
    generation += 1;
    setState((current) => {
      current.agents = [];
      current.loaded = false;
      current.usage = [];
    });
  }

  /** The agents that the user gave a usage prompt and that answered, in the order of the list. */
  function customAgentUsage(): CustomAgentUsageRow[] {
    return state.agents.flatMap((agent) => {
      const answer = agent.usagePrompt ? state.usage.find((usage) => usage.id === agent.id) : undefined;
      return answer ? [{ id: agent.id, name: agent.name, text: answer.text }] : [];
    });
  }

  /** Each agent answers in a model-list process, so this can take as long as the slowest agent. */
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

  /** One trial start. Writes nothing, so the list does not change. */
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
