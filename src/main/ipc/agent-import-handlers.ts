// Agent import into the local host. The file dialog opens here, so the renderer never names a path.

import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseApplyAgentImportInput } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { app, type BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import type { AgentImportService } from "../agent-import-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface AgentImportIpcDependencies {
  agentImport: AgentImportService;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
  /** The export skill a user adds to Grok Bot by hand. It ships in the app's resources. */
  exportSkillPath: string;
}

export function agentImportIpcHandlers({
  agentImport,
  getMainWindow,
  translate,
  exportSkillPath,
}: AgentImportIpcDependencies): Pick<IpcGroupHandlers, "agentImport"> {
  return {
    agentImport: {
      choose: handler(async () => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: translate("dialog.chooseAgentExport"),
          properties: ["openFile"],
          filters: [{ name: translate("dialog.filter.agentExports"), extensions: ["zip"] }],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled || !result.filePaths[0] ? null : agentImport.stage(result.filePaths[0]);
      }),
      apply: payloadHandler(parseApplyAgentImportInput, (input) => agentImport.apply(input)),
      discard: payloadHandler(stringPayload("token"), (token) => agentImport.discard(token)),
      readSkill: handler(() => readFile(exportSkillPath, "utf8")),
      saveSkill: handler(async () => {
        const mainWindow = getMainWindow();
        const options: SaveDialogOptions = {
          title: translate("dialog.saveExportSkill"),
          defaultPath: join(app.getPath("downloads"), "SKILL.md"),
          filters: [{ name: "Markdown", extensions: ["md"] }],
        };
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return { saved: false };
        await copyFile(exportSkillPath, result.filePath);
        return { saved: true };
      }),
    },
  };
}
