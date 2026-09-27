// Local model servers, the model list of one endpoint, and where the scan looks. This computer only:
// no Team API route reaches these.

import type { ProviderDetection } from "../provider-detection";
import type { ProviderDetectionSettingsStore } from "../provider-detection-settings-store";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { parseDiscoverModels, parseProviderDetectionSettings } from "./provider-detection-inputs";

export interface ProviderDetectionIpcDependencies {
  detection: ProviderDetection;
  settings: Pick<ProviderDetectionSettingsStore, "get" | "set">;
}

export function providerDetectionIpcHandlers({
  detection,
  settings,
}: ProviderDetectionIpcDependencies): Pick<IpcGroupHandlers, "providerDetection"> {
  return {
    providerDetection: {
      scanModelServers: handler(() => detection.scanModelServers()),
      scanAgents: handler(() => detection.scanAgents()),
      discoverModels: payloadHandler(parseDiscoverModels, (input) => detection.discoverModels(input)),
      getSettings: handler(() => settings.get()),
      setSettings: payloadHandler(parseProviderDetectionSettings, (next) => settings.set(next)),
    },
  };
}
