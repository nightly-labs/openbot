import type { HostAdminDesktopApi, HostReleaseStatus, HostUpdateStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

export interface MockHostUpdateOptions {
  /** The update of a joined server's host, as `host-update-v1` reports it. */
  hostUpdate?: HostUpdateStatus;
  hostRelease?: HostReleaseStatus;
}

const MOCK_HOST_UPDATE: HostUpdateStatus = {
  phase: "available",
  currentVersion: "0.23.0",
  availableVersion: "0.24.0",
  progress: null,
  errorCode: null,
  remoteUpdates: "allowed",
  autoDownload: true,
  autoInstall: false,
  restart: null,
};

type MockHostUpdateApi = Pick<
  HostAdminDesktopApi,
  | "getReleaseStatus"
  | "checkRelease"
  | "getUpdateStatus"
  | "checkForUpdate"
  | "startUpdate"
  | "cancelUpdate"
  | "setUpdateSettings"
>;

/**
 * One remote host's update. A start downloads at once, and a restart that waits for idle waits for
 * one agent turn until the admin chooses `now`; the preview host then stays at "installing".
 */
export function createMockHostUpdate(options: MockHostUpdateOptions): MockHostUpdateApi {
  let status = clone(options.hostUpdate ?? MOCK_HOST_UPDATE);
  const refuse = () => {
    if (status.remoteUpdates === "disabled") throw new Error(sourceText("error.update.remoteDisabled"));
    if (status.remoteUpdates === "managed") throw new Error(sourceText("error.update.managedByHost"));
  };
  let release: HostReleaseStatus = options.hostRelease ?? {
    currentVersion: status.currentVersion,
    latestVersion: status.availableVersion,
    phase: "idle",
    method:
      status.remoteUpdates === "managed" ? "host-manager" : status.phase === "unsupported" ? "hosted" : "self-update",
  };
  return {
    getReleaseStatus: async () => clone(release),
    checkRelease: async () => {
      release = {
        ...release,
        phase: release.latestVersion && release.latestVersion !== release.currentVersion ? "available" : "up-to-date",
      };
      return clone(release);
    },
    getUpdateStatus: async () => clone(status),
    checkForUpdate: async () => {
      refuse();
      return clone(status);
    },
    startUpdate: async (mode) => {
      refuse();
      if (!status.availableVersion) return clone(status);
      status = {
        ...status,
        phase: mode === "now" ? "installing" : "ready",
        progress: 100,
        restart: { requestedBy: "Preview admin", mode, waitingFor: mode === "now" ? [] : ["agent-turn"] },
      };
      return clone(status);
    },
    setUpdateSettings: async (settings) => {
      refuse();
      status = { ...status, ...settings };
      return clone(status);
    },
    cancelUpdate: async () => {
      if (status.phase === "installing") throw new Error(sourceText("error.update.restartStarted"));
      status = { ...status, restart: null };
      return clone(status);
    },
  };
}
