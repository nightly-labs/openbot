// The disk and machine calls of the web client, for the sidebar warning cards and the Storage
// section. Desktop sends the same routes through preload and main.

import {
  decodeMachineAlertSettings,
  decodeMachineMetrics,
  decodeStorageDisk,
  type MachineAlertSettings,
} from "@openbot/contracts/ipc";
import {
  MACHINE_RESOURCES_CAPABILITY,
  MACHINE_RESOURCES_ROUTES,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { STORAGE_DISK_CAPABILITY, STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import type { FilesPort } from "../files/files-port";
import type { SidebarCardsPort } from "../sidebar/sidebar-port";

/**
 * As on desktop, a host without the capability has no reading: null for the disk and the machine
 * use, an error for the alert settings. `request` names the connected host and throws for any
 * other, so each call is async and rejects instead.
 */
export function webMachineCalls(
  request: (serverId: string) => TeamApiRequest,
  hasCapability: (capability: string) => boolean,
): SidebarCardsPort & { hostAdmin: NonNullable<FilesPort["hostAdmin"]> } {
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
        hasCapability(STORAGE_DISK_CAPABILITY)
          ? request(serverId)("POST", STORAGE_DISK_ROUTES.disk, decodeStorageDisk, {})
          : null,
      getMachineMetrics: async (serverId) =>
        hasCapability(MACHINE_RESOURCES_CAPABILITY)
          ? request(serverId)("POST", MACHINE_RESOURCES_ROUTES.metrics, decodeMachineMetrics, {})
          : null,
    },
    hostAdmin: {
      getMachineAlerts: (serverId) => alerts(serverId),
      setMachineAlerts: (settings, serverId) => alerts(serverId, settings),
    },
  };
}
