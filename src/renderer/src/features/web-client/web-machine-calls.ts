import {
  decodeLibraryFoldersSnapshot,
  decodeMachineAlertSettings,
  decodeMachineMetrics,
  decodeStorageDisk,
  type MachineAlertSettings,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import {
  LIBRARY_FOLDERS_CAPABILITY,
  LIBRARY_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/library-folders-v1";
import {
  MACHINE_RESOURCES_CAPABILITY,
  MACHINE_RESOURCES_ROUTES,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { STORAGE_DISK_CAPABILITY, STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import {
  STORAGE_USER_FILES_CAPABILITY,
  STORAGE_USER_FILES_ROUTES,
} from "@openbot/contracts/team-protocol/storage-user-files-v1";
import { decodeTeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import type { FilesPort } from "../files/files-port";
import type { SidebarCardsPort } from "../sidebar/sidebar-port";

export function webMachineCalls(
  request: (serverId: string) => TeamApiRequest,
  hasCapability: (capability: string) => boolean,
): SidebarCardsPort & {
  storage: Pick<OpenBotDesktopApi["storage"], "getLibraryFolders" | "changeLibraryFolders">;
  hostAdmin: NonNullable<FilesPort["hostAdmin"]>;
} {
  async function alerts(serverId: string, settings?: MachineAlertSettings) {
    if (!hasCapability(MACHINE_RESOURCES_CAPABILITY))
      throw new Error(currentText().t("error.team.machineResourcesUnsupported"));
    if (!settings) return request(serverId)("POST", MACHINE_RESOURCES_ROUTES.alerts, decodeMachineAlertSettings, {});
    const { diskPercent, memoryPercent, cpuPercent, responsibleMemberId } = settings;
    return request(serverId)("POST", MACHINE_RESOURCES_ROUTES.updateAlerts, decodeMachineAlertSettings, {
      diskPercent,
      memoryPercent,
      cpuPercent,
      responsibleMemberId,
    });
  }
  return {
    storage: {
      getDisk: async (serverId) =>
        hasCapability(STORAGE_USER_FILES_CAPABILITY)
          ? request(serverId)("POST", STORAGE_USER_FILES_ROUTES.disk, decodeStorageDisk, {})
          : hasCapability(STORAGE_DISK_CAPABILITY)
            ? request(serverId)("POST", STORAGE_DISK_ROUTES.disk, decodeStorageDisk, {})
            : null,
      getMachineMetrics: async (serverId) =>
        hasCapability(MACHINE_RESOURCES_CAPABILITY)
          ? request(serverId)("POST", MACHINE_RESOURCES_ROUTES.metrics, decodeMachineMetrics, {})
          : null,
      getLibraryFolders: async (serverId) =>
        hasCapability(LIBRARY_FOLDERS_CAPABILITY)
          ? request(serverId)("POST", LIBRARY_FOLDERS_ROUTES.read, decodeLibraryFoldersSnapshot, {})
          : null,
      changeLibraryFolders: async (action, serverId) => {
        if (!hasCapability(LIBRARY_FOLDERS_CAPABILITY))
          throw new Error(currentText().t("error.team.libraryFoldersUnsupported"));
        return request(serverId)(
          "POST",
          LIBRARY_FOLDERS_ROUTES.actions,
          decodeLibraryFoldersSnapshot,
          decodeTeamProtocolV2Json(action),
        );
      },
    },
    hostAdmin: {
      getMachineAlerts: (serverId) => alerts(serverId),
      setMachineAlerts: (settings, serverId) => alerts(serverId, settings),
    },
  };
}
