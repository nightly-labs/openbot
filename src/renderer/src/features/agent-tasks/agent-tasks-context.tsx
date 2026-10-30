import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { agentTasksPort } from "./agent-tasks-port";
import { createAgentTasks } from "./agent-tasks-state";

/**
 * The side threads of the active server. A joined server shows them when it has the `agent-tasks-v1`
 * routes, and renames and deletes them only with `agent-threads-v1`.
 */
const AgentTasks = createSimpleContext({
  name: "AgentTasks",
  init: () => {
    const { activeServer, activeServerSupportsCapability } = useServers();
    const { activeAgentId, agentStatus } = useAgents();
    const local = () => {
      const server = activeServer();
      return !server || server.kind === "local";
    };
    return createAgentTasks({
      port: agentTasksPort,
      activeAgentId,
      local,
      available: () => local() || activeServerSupportsCapability("agent-tasks-v1"),
      editable: () => local() || activeServerSupportsCapability("agent-threads-v1"),
      readable: () => local() || activeServerSupportsCapability("agent-thread-reads-v1"),
      reloadKey: () => agentStatus().phase,
    });
  },
});

export const AgentTasksProvider = AgentTasks.provider;
export const useAgentTasks = AgentTasks.use;
