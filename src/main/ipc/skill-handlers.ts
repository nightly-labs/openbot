import { Effect } from "effect";
import { localSkillTools } from "../local-skill-tools";
import {
  parseCreateLocalSkill,
  parseInstallLocalSkill,
  parseReadLocalSkill,
  parseReviseLocalSkill,
} from "./local-skill-inputs";
// The skill marketplace, and the skills installed into a workspace.

import type { AppTranslate } from "@openbot/i18n";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import {
  parseInstallSkill,
  parseMarketplaceSkillQuery,
  parseSetEnabledSkill,
  parseSubmitSkill,
  parseUninstallSkill,
} from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { nullishPayload, stringPayload } from "./validation";

export interface SkillIpcDependencies {
  skills: SkillMarketplaceService;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function skillIpcHandlers({
  skills,
  getMainWindow,
  translate,
}: SkillIpcDependencies): Pick<IpcGroupHandlers, "skills"> {
  return {
    skills: {
      localList: handler(() =>
        Effect.runPromise(
          localSkillTools(skills)
            .list()
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      localGet: payloadHandler(parseReadLocalSkill, (input) =>
        Effect.runPromise(
          localSkillTools(skills)
            .get(input)
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      localCreate: payloadHandler(parseCreateLocalSkill, (input) =>
        Effect.runPromise(
          localSkillTools(skills)
            .create(input)
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      localRevise: payloadHandler(parseReviseLocalSkill, (input) =>
        Effect.runPromise(
          localSkillTools(skills)
            .revise(input)
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      localInstall: payloadHandler(parseInstallLocalSkill, (input) =>
        Effect.runPromise(
          localSkillTools(skills)
            .install(input)
            .pipe(Effect.mapError((error) => error.cause)),
        ),
      ),
      list: payloadHandler(nullishPayload(parseMarketplaceSkillQuery), (query) =>
        Effect.runPromise(skills.list(query).pipe(Effect.mapError((error) => error.cause))),
      ),
      get: payloadHandler(stringPayload("skillId"), (skillId) =>
        Effect.runPromise(skills.get(skillId).pipe(Effect.mapError((error) => error.cause))),
      ),
      listMine: handler(() => Effect.runPromise(skills.listMine().pipe(Effect.mapError((error) => error.cause)))),
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
        return result.canceled || !result.filePaths[0]
          ? null
          : Effect.runPromise(skills.stage(result.filePaths[0]).pipe(Effect.mapError((error) => error.cause)));
      }),
      submit: payloadHandler(parseSubmitSkill, (submission) =>
        Effect.runPromise(skills.submit(submission).pipe(Effect.mapError((error) => error.cause))),
      ),
      listInstalled: payloadHandler(stringPayload("agentId"), (agentId) =>
        Effect.runPromise(skills.listInstalled(agentId).pipe(Effect.mapError((error) => error.cause))),
      ),
      install: payloadHandler(parseInstallSkill, (installation) =>
        Effect.runPromise(skills.install(installation).pipe(Effect.mapError((error) => error.cause))),
      ),
      uninstall: payloadHandler(parseUninstallSkill, (removal) =>
        Effect.runPromise(skills.uninstall(removal).pipe(Effect.mapError((error) => error.cause))),
      ),
      setEnabled: payloadHandler(parseSetEnabledSkill, (change) =>
        Effect.runPromise(skills.setEnabled(change).pipe(Effect.mapError((error) => error.cause))),
      ),
    },
  };
}
