// The application updater and its auto-download preference.

import { readUpdatePreference, writeUpdatePreference } from "../update-preference-store";
import type { UpdateService } from "../update-service";
import { parseUpdatePreference } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface UpdateIpcDependencies {
  updater: UpdateService;
  updatePreferenceFile: string;
}

export function updateIpcHandlers({
  updater,
  updatePreferenceFile,
}: UpdateIpcDependencies): Pick<IpcGroupHandlers, "update"> {
  return {
    update: {
      getStatus: handler(() => updater.getStatus()),
      check: handler(() => updater.checkForUpdates()),
      download: handler(() => updater.downloadUpdate()),
      install: handler(() => updater.installUpdate()),
      getPreference: handler(() => readUpdatePreference(updatePreferenceFile)),
      setPreference: payloadHandler(parseUpdatePreference, async (parsed) => {
        const preference = await writeUpdatePreference(updatePreferenceFile, parsed.autoDownload);
        updater.setAutoDownload(preference.autoDownload);
        return preference;
      }),
    },
  };
}
