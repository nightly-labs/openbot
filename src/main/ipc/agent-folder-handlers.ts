// The folders a local agent can change besides its workspace and the shared folder. Only the local
// service answers here; an owner or admin on another device uses `agent-folders-v1`.

import { join } from "node:path";
import { type AgentExclusionChange, parseAgentFolderInput, parseChooseAgentFolderInput } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { AgentFolders } from "../agent-folders";
import { parseAgentId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface AgentFolderIpcDependencies {
  folders: AgentFolders;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function agentFolderIpcHandlers({
  folders,
  getMainWindow,
  translate,
}: AgentFolderIpcDependencies): Pick<IpcGroupHandlers, "agentFolders"> {
  /** A second press on + while the picker is open does not open another one. */
  let picking = false;

  /** The picked folder, or undefined when the user cancels or a picker is already open. */
  async function pick(options: OpenDialogOptions): Promise<string | undefined> {
    if (picking) return undefined;
    picking = true;
    const parent = getMainWindow();
    const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)).finally(
      () => {
        picking = false;
      },
    );
    return result.canceled ? undefined : result.filePaths[0];
  }

  return {
    agentFolders: {
      listAgentFolders: payloadHandler(parseAgentId, (agentId) => folders.list(agentId)),
      chooseAgentFolder: payloadHandler(parseChooseAgentFolderInput, async ({ agentId, replace }) => {
        const agent = folders.requireAgent(agentId);
        const picked = await pick({
          title: translate("dialog.chooseAgentFolder", { agent: agent.name }),
          properties: ["openDirectory", "createDirectory"],
          ...(replace === undefined ? {} : { defaultPath: join(replace, "..") }),
        });
        if (picked === undefined) return { outcome: "cancelled", list: await folders.list(agentId) };
        return folders.add(agentId, picked, replace);
      }),
      addAgentFolder: payloadHandler(parseAgentFolderInput, ({ agentId, path }) => folders.add(agentId, path)),
      chooseAgentExclusion: payloadHandler(parseAgentId, async (agentId): Promise<AgentExclusionChange> => {
        const agent = folders.requireAgent(agentId);
        // The picker opens in the first added folder, else in the workspace.
        const picked = await pick({
          title: translate("dialog.chooseAgentExclusion", { agent: agent.name }),
          properties: ["openDirectory"],
          defaultPath: agent.additionalFolders?.[0] ?? agent.workspacePath,
        });
        if (picked === undefined) return { outcome: "cancelled", list: await folders.list(agentId) };
        return folders.exclude(agentId, picked);
      }),
      addAgentExclusion: payloadHandler(parseAgentFolderInput, ({ agentId, path }) => folders.exclude(agentId, path)),
      removeAgentExclusion: payloadHandler(parseAgentFolderInput, ({ agentId, path }) =>
        folders.include(agentId, path),
      ),
      removeAgentFolder: payloadHandler(parseAgentFolderInput, ({ agentId, path }) => folders.remove(agentId, path)),
    },
  };
}
