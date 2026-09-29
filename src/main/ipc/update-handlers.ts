// The application updater, its preferences, and the restart an admin of a joined server asked for.

import type { RequestedUpdate } from "../requested-update";
import { readUpdatePreference } from "../update-preference-store";
import type { UpdateService } from "../update-service";
import { parseUpdatePreference } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface UpdateIpcDependencies {
  updater: UpdateService;
  updatePreferenceFile: string;
  requestedUpdate: Pick<RequestedUpdate, "cancel" | "setPreference">;
}

export function updateIpcHandlers({
  updater,
  updatePreferenceFile,
  requestedUpdate,
}: UpdateIpcDependencies): Pick<IpcGroupHandlers, "update"> {
  return {
    update: {
      getStatus: handler(() => updater.getStatus()),
      check: handler(() => updater.checkForUpdates()),
      download: handler(() => updater.downloadUpdate()),
      install: handler(() => updater.installUpdate()),
      getPreference: handler(() => readUpdatePreference(updatePreferenceFile)),
      setPreference: payloadHandler(parseUpdatePreference, (parsed) => requestedUpdate.setPreference(parsed)),
      cancelScheduledRestart: handler(() => {
        requestedUpdate.cancel();
        return updater.getStatus();
      }),
    },
  };
}
