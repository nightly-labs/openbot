import { Effect } from "effect";

// Local model servers, the model list of one endpoint, and where the scan looks. This computer only:
// no Team API route reaches these.

import { runCauseEffect } from "../../backend/effect-boundary";
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
      scanModelServers: handler(() => Effect.runPromise(detection.scanModelServers())),
      scanAgents: handler(() => Effect.runPromise(detection.scanAgents())),
      discoverModels: payloadHandler(parseDiscoverModels, (input) =>
        Effect.runPromise(detection.discoverModels(input)),
      ),
      getSettings: handler(() => settings.get()),
      setSettings: payloadHandler(parseProviderDetectionSettings, (next) => runCauseEffect(settings.set(next))),
    },
  };
}
