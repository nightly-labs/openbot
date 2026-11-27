import { agentFolderParent, type OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { AgentFolderCalls } from "@openbot/ui/features/conversation/AgentFolders";
import type {
  AgentInstructionsCalls,
  AgentInstructionsFileCalls,
} from "@openbot/ui/features/conversation/AgentInstructionsView";
import type { HostFolderPickMode } from "@openbot/ui/features/conversation/HostFolderPicker";

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

export type HostFolderPickFn = (
  agentId: string,
  mode: HostFolderPickMode,
  start: string | null,
) => Promise<string | null>;

export type AgentFoldersApi = Pick<
  OpenBotDesktopApi["agent"],
  | "listAgentFolders"
  | "addAgentFolder"
  | "removeAgentFolder"
  | "addAgentExclusion"
  | "removeAgentExclusion"
  | "browseAgentFolders"
>;

export type AgentInstructionsApi = Pick<OpenBotDesktopApi["agent"], "readAgentInstructions" | "saveAgentInstructions">;

export function remoteAgentFolderCalls(
  serverId: string,
  pick: HostFolderPickFn,
  api?: AgentFoldersApi,
): AgentFolderCalls {
  const agent = () => api ?? window.openbot.agent;
  const list = (agentId: string) => agent().listAgentFolders(agentId, serverId);
  return {
    list,
    choose: async (agentId, replace) => {
      const picked = await pick(
        agentId,
        replace === undefined ? "add" : "locate",
        replace === undefined ? null : agentFolderParent(replace),
      );
      if (picked === null) return { outcome: "cancelled", list: await list(agentId) };
      return agent().addAgentFolder(
        replace === undefined ? { agentId, path: picked } : { agentId, path: picked, replace },
        serverId,
      );
    },
    add: (agentId, path) => agent().addAgentFolder({ agentId, path }, serverId),
    remove: (agentId, path) => agent().removeAgentFolder({ agentId, path }, serverId),
    exclude: async (agentId) => {
      const current = await list(agentId);
      const picked = await pick(agentId, "exclude", current.folders[0]?.path ?? current.workspace);
      if (picked === null) return { outcome: "cancelled", list: await list(agentId) };
      return agent().addAgentExclusion({ agentId, path: picked }, serverId);
    },
    addExclusion: (agentId, path) => agent().addAgentExclusion({ agentId, path }, serverId),
    include: (agentId, path) => agent().removeAgentExclusion({ agentId, path }, serverId),
  };
}

export function browseHostFolders(serverId: string, agentId: string, path: string | null, api?: AgentFoldersApi) {
  return (api ?? window.openbot.agent).browseAgentFolders({ agentId, path }, serverId);
}

type InstructionsWatcher = Parameters<AgentInstructionsFileCalls["watch"]>[0];

const instructionsWatchers = new Map<string, Set<InstructionsWatcher>>();

function watchersOf(serverKey: string): Set<InstructionsWatcher> {
  let watchers = instructionsWatchers.get(serverKey);
  if (!watchers) {
    watchers = new Set();
    instructionsWatchers.set(serverKey, watchers);
  }
  return watchers;
}

export function agentInstructionsCalls(
  serverId?: string,
  api?: AgentInstructionsApi,
): Omit<AgentInstructionsCalls, "openLink"> {
  const watchers = watchersOf(serverId ?? "");
  const agent = () => api ?? window.openbot.agent;
  return {
    read: (agentId) => agent().readAgentInstructions(agentId, serverId),
    save: async (agentId, text, expected) => {
      const file = await agent().saveAgentInstructions({ agentId, text, expected }, serverId);
      for (const watcher of watchers) watcher(agentId, file);
      return file;
    },
    watch: (watcher) => {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
    reveal: serverId === undefined ? (agentId) => window.openbot.agent.revealAgentInstructions(agentId) : undefined,
  };
}
