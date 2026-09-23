// Agent import into the local host. The file dialog opens here, so the renderer never names a path.

import { parseApplyAgentImportInput } from "@openbot/contracts/ipc";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { AgentImportService } from "../agent-import-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface AgentImportIpcDependencies {
  agentImport: AgentImportService;
  getMainWindow: () => BrowserWindow | null;
}

export function agentImportIpcHandlers({
  agentImport,
  getMainWindow,
}: AgentImportIpcDependencies): Pick<IpcGroupHandlers, "agentImport"> {
  return {
    agentImport: {
      choose: handler(async () => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: "Choose an agent export",
          properties: ["openFile"],
          filters: [{ name: "Agent exports", extensions: ["zip"] }],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled || !result.filePaths[0] ? null : agentImport.stage(result.filePaths[0]);
      }),
      apply: payloadHandler(parseApplyAgentImportInput, (input) => agentImport.apply(input)),
      discard: payloadHandler(stringPayload("token"), (token) => agentImport.discard(token)),
    },
  };
}
