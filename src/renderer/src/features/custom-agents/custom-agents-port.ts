import {
  type CheckCustomAgentInput,
  type CustomAgentCheckResult,
  type CustomAgentResult,
  type CustomAgentSummary,
  type CustomAgentUsage,
  type DeleteCustomAgentInput,
  LOCAL_SERVER_ID,
  type OpenBotDesktopApi,
  type SaveCustomAgentInput,
} from "@openbot/contracts/ipc";

/** What the custom agents context reaches in main: the ACP agents the user added. */
interface CustomAgentsPort {
  customAgents: OpenBotDesktopApi["customAgents"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
function customAgentsPort(): CustomAgentsPort {
  return window.openbot;
}

/**
 * The agent calls of one computer. `custom-agents-v1` has no trial start and no usage answers, so a
 * joined server's host has neither `check` nor `usage`.
 */
export interface CustomAgentsEndpointApi {
  list: () => Promise<CustomAgentSummary[]>;
  save: (input: SaveCustomAgentInput) => Promise<CustomAgentResult>;
  delete: (input: DeleteCustomAgentInput) => Promise<CustomAgentResult>;
  check?: ((input: CheckCustomAgentInput) => Promise<CustomAgentCheckResult>) | undefined;
  usage?: (() => Promise<CustomAgentUsage[]>) | undefined;
}

/** This computer's agents. */
export function localCustomAgentsApi(): CustomAgentsEndpointApi {
  const api = () => customAgentsPort().customAgents;
  return {
    list: () => api().list(LOCAL_SERVER_ID),
    save: (input) => api().save(input, LOCAL_SERVER_ID),
    delete: (input) => api().delete(input, LOCAL_SERVER_ID),
    check: (input) => api().check(input),
    usage: () => api().usage(),
  };
}

/** The agents of a joined server's host, for an owner or admin, through `custom-agents-v1`. */
export function hostCustomAgentsApi(serverId: string): CustomAgentsEndpointApi {
  const api = () => customAgentsPort().customAgents;
  return {
    list: () => api().list(serverId),
    save: (input) => api().save(input, serverId),
    delete: (input) => api().delete(input, serverId),
  };
}
