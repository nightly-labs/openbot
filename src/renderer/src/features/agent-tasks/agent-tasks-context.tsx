import { AGENT_THREAD_PAGES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-pages-v1";
import { MESSAGE_DELETE_CAPABILITY } from "@openbot/contracts/team-protocol/message-delete-v1";
import { MESSAGE_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/message-pins-v1";
import { untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { agentTasksPort } from "./agent-tasks-port";
import { createAgentTasks } from "./agent-tasks-state";

/**
 * The side threads of the active server. A joined server shows them when it has the `agent-tasks-v1`
 * routes, renames and deletes them only with `agent-threads-v1`, and branches only with
 * `agent-thread-branches-v1`.
 */
const AgentTasks = createSimpleContext({
  name: "AgentTasks",
  init: () => {
    const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
    const { activeAgentId, agentStatus } = useAgents();
    // The server scope makes this state again for each server, so the server is fixed here.
    const scopeServerId = untrack(activeServerId);
    const local = () => {
      const server = activeServer();
      return !server || server.kind === "local";
    };
    return createAgentTasks({
      port: () => agentTasksPort(scopeServerId),
      activeAgentId,
      queuedMessageMovable: () => local() || activeServerSupportsCapability("agent-queue-task-v1"),
      available: () => local() || activeServerSupportsCapability("agent-tasks-v1"),
      editable: () => local() || activeServerSupportsCapability("agent-threads-v1"),
      readable: () => local() || activeServerSupportsCapability("agent-thread-reads-v1"),
      branchable: () => local() || activeServerSupportsCapability("agent-thread-branches-v1"),
      filesAccepted: () => local() || activeServerSupportsCapability("agent-thread-files-v1"),
      repliable: () => local() || activeServerSupportsCapability("agent-thread-replies-v1"),
      messageDeletable: () => local() || activeServerSupportsCapability(MESSAGE_DELETE_CAPABILITY),
      pageable: () => local() || activeServerSupportsCapability(AGENT_THREAD_PAGES_CAPABILITY),
      aroundReadable: () => local() || activeServerSupportsCapability(MESSAGE_PINS_CAPABILITY),
      // A server switch or reconnect reads the lists again, and so does a start of the agent.
      reloadKey: () => {
        const server = activeServer();
        return `${server?.id ?? ""}:${server?.state ?? ""}:${agentStatus().phase}`;
      },
    });
  },
});

export const AgentTasksProvider = AgentTasks.provider;
export const useAgentTasks = AgentTasks.use;
