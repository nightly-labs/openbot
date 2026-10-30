// The bridge calls behind an agent's Folders row, the Folders page, the chat's folder drop and the
// Instructions field. Only the local server has them: the Team API does not carry them.

import type { AgentFolderCalls } from "@openbot/ui/features/conversation/AgentFolders";
import type { AgentInstructionsCalls } from "@openbot/ui/features/conversation/AgentInstructionsField";

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

/** The instruction file in a local agent's workspace. The Team API does not carry it. */
export function agentInstructionsCalls(): AgentInstructionsCalls {
  return {
    read: (agentId) => window.openbot.agent.readAgentInstructions(agentId),
    save: (agentId, text, expected) => window.openbot.agent.saveAgentInstructions({ agentId, text, expected }),
  };
}
