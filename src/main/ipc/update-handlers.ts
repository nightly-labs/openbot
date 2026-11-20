import { runCauseEffect } from "../../backend/effect-boundary";
import type { IdleRestart } from "../idle-restart";
import type { RequestedUpdate } from "../requested-update";
import { readUpdatePreference } from "../update-preference-store";
import type { RestartReadiness } from "../update-readiness";
import type { UpdateService } from "../update-service";
import { parseIdleRestartTarget, parseUpdatePreference } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface UpdateIpcDependencies {
  updater: UpdateService;
  updatePreferenceFile: string;
  requestedUpdate: Pick<RequestedUpdate, "cancel" | "setPreference">;
  idleRestart: Pick<IdleRestart, "request" | "cancel">;
  describeReadiness: () => RestartReadiness;
}

function restartWouldStopWork({ reasons }: RestartReadiness): boolean {
  return reasons.some((reason) => reason !== "initialization");
}

export function updateIpcHandlers({
  updater,
  updatePreferenceFile,
  requestedUpdate,
  idleRestart,
  describeReadiness,
}: UpdateIpcDependencies): Pick<IpcGroupHandlers, "update"> {
  return {
    update: {
      getStatus: handler(() => updater.getStatus()),
      check: handler(() => runCauseEffect(updater.checkForUpdates())),
      download: handler(() => runCauseEffect(updater.downloadUpdate())),
      install: handler(async () => {
        if (restartWouldStopWork(describeReadiness())) return idleRestart.request("update");
        await runCauseEffect(updater.installUpdate());
        return updater.getStatus();
      }),
      getPreference: handler(() => runCauseEffect(readUpdatePreference(updatePreferenceFile))),
      setPreference: payloadHandler(parseUpdatePreference, (parsed) =>
        runCauseEffect(requestedUpdate.setPreference(parsed)),
      ),
      cancelScheduledRestart: handler(() => {
        requestedUpdate.cancel();
        return updater.getStatus();
      }),
      restartWhenIdle: payloadHandler(parseIdleRestartTarget, (target) => idleRestart.request(target)),
      cancelIdleRestart: handler(() => idleRestart.cancel()),
    },
  };
}
