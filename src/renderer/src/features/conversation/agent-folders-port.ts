// The bridge calls behind an agent's Folders row, the Folders page and the chat's folder drop. Only
// the local server has them: the Team API does not carry an agent's folders.

import type { AgentFolderCalls } from "@openbot/ui/features/conversation/AgentFolders";

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function agentFolderCalls(): AgentFolderCalls {
  return {
    list: (agentId) => window.openbot.agent.listAgentFolders(agentId),
    choose: (agentId, replace) =>
      window.openbot.agent.chooseAgentFolder(replace === undefined ? { agentId } : { agentId, replace }),
    add: (agentId, path) => window.openbot.agent.addAgentFolder({ agentId, path }),
    remove: (agentId, path) => window.openbot.agent.removeAgentFolder({ agentId, path }),
    drop: (agentId, folder) => window.openbot.agent.addDroppedAgentFolder(agentId, folder),
    exclude: (agentId) => window.openbot.agent.chooseAgentExclusion(agentId),
    addExclusion: (agentId, path) => window.openbot.agent.addAgentExclusion({ agentId, path }),
    include: (agentId, path) => window.openbot.agent.removeAgentExclusion({ agentId, path }),
  };
}
