import type { AppTranslate } from "@openbot/i18n";
import { Effect } from "effect";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import { localSkillTools } from "../local-skill-tools";
import type { PluginCatalogService } from "../plugin-catalog-service";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import {
  parseInstallSkill,
  parseMarketplaceSkillQuery,
  parseSetEnabledSkill,
  parseSubmitSkill,
  parseUninstallSkill,
  requireSkillId,
} from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseCreateLocalSkill,
  parseInstallLocalSkill,
  parseReadLocalSkill,
  parseReviseLocalSkill,
  parseSetLocalSkillGlobal,
} from "./local-skill-inputs";
import { nullishPayload, stringPayload } from "./validation";

export interface SkillIpcDependencies {
  skills: SkillMarketplaceService;
  pluginCatalog: Pick<PluginCatalogService, "load">;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function skillIpcHandlers({
  skills,
  pluginCatalog,
  getMainWindow,
  translate,
}: SkillIpcDependencies): Pick<IpcGroupHandlers, "skills"> {
  return {
    skills: {
      localList: handler(async () => (await runCauseEffect(localSkillTools(skills).list())).skills),
      localGet: payloadHandler(parseReadLocalSkill, (input) => runCauseEffect(localSkillTools(skills).get(input))),
      localCreate: payloadHandler(parseCreateLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).create(input)),
      ),
      localRevise: payloadHandler(parseReviseLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).revise(input)),
      ),
      localInstall: payloadHandler(parseInstallLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).install(input)),
      ),
      localSetGlobal: payloadHandler(parseSetLocalSkillGlobal, (input) =>
        runCauseEffect(skills.setLocalGlobal(input.skillId, input.global)),
      ),
      list: payloadHandler(nullishPayload(parseMarketplaceSkillQuery), (query) => runCauseEffect(skills.list(query))),
      get: payloadHandler(requireSkillId, (skillId) => runCauseEffect(skills.get(skillId))),
      getBySlug: payloadHandler(stringPayload("slug"), (slug) => runCauseEffect(skills.getBySlug(slug))),
      pluginCatalog: handler(() => Effect.runPromise(pluginCatalog.load())),
      listMine: handler(() => runCauseEffect(skills.listMine())),
      choosePackage: handler(async () => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: translate("dialog.chooseSkill"),
          properties: ["openFile", "openDirectory"],
          filters: [{ name: translate("dialog.filter.skillPackages"), extensions: ["zip"] }],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled || !result.filePaths[0] ? null : runCauseEffect(skills.stage(result.filePaths[0]));
      }),
      submit: payloadHandler(parseSubmitSkill, (submission) => runCauseEffect(skills.submit(submission))),
      listInstalled: payloadHandler(stringPayload("agentId"), (agentId) =>
        runCauseEffect(skills.listInstalled(agentId)),
      ),
      install: payloadHandler(parseInstallSkill, (installation) => runCauseEffect(skills.install(installation))),
      uninstall: payloadHandler(parseUninstallSkill, (removal) => runCauseEffect(skills.uninstall(removal))),
      setEnabled: payloadHandler(parseSetEnabledSkill, (change) => runCauseEffect(skills.setEnabled(change))),
    },
  };
}
