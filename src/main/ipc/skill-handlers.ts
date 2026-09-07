// The skill marketplace, and the skills installed into a workspace.

import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import { parseInstallSkill, parseMarketplaceSkillQuery, parseSubmitSkill, parseUninstallSkill } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { nullishPayload, stringPayload } from "./validation";

export interface SkillIpcDependencies {
  skills: SkillMarketplaceService;
  getMainWindow: () => BrowserWindow | null;
}

export function skillIpcHandlers({ skills, getMainWindow }: SkillIpcDependencies): Pick<IpcGroupHandlers, "skills"> {
  return {
    skills: {
      list: payloadHandler(nullishPayload(parseMarketplaceSkillQuery), (query) => skills.list(query)),
      get: payloadHandler(stringPayload("skillId"), (skillId) => skills.get(skillId)),
      listMine: handler(() => skills.listMine()),
      choosePackage: handler(async () => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: "Choose a skill folder or ZIP",
          properties: ["openFile", "openDirectory"],
          filters: [{ name: "Skill packages", extensions: ["zip"] }],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled || !result.filePaths[0] ? null : skills.stage(result.filePaths[0]);
      }),
      submit: payloadHandler(parseSubmitSkill, (submission) => skills.submit(submission)),
      listInstalled: payloadHandler(stringPayload("agentId"), (agentId) => skills.listInstalled(agentId)),
      install: payloadHandler(parseInstallSkill, (installation) => skills.install(installation)),
      uninstall: payloadHandler(parseUninstallSkill, (removal) => skills.uninstall(removal)),
    },
  };
}
