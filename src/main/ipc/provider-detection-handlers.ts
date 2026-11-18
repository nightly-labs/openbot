import { Effect } from "effect";

// Local model servers, the model list of one endpoint, and where the scan looks. The computer that
// runs the agents of the server looks: this one, or a joined server's host for an owner or admin,
// through `provider-detection-v1`. The host makes each request from the host.

import {
  decodeDetectedAgents,
  decodeDetectedModelServers,
  decodeDetectionSettings,
  decodeDiscoveredModels,
  PROVIDER_DETECTION_CAPABILITY,
  PROVIDER_DETECTION_ROUTES,
} from "@openbot/contracts/team-protocol/provider-detection-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ProviderDetection } from "../provider-detection";
import type { ProviderDetectionSettingsStore } from "../provider-detection-settings-store";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { parseDiscoverModels, parseProviderDetectionSettings } from "./provider-detection-inputs";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

export interface ProviderDetectionIpcDependencies {
  detection: ProviderDetection;
  settings: Pick<ProviderDetectionSettingsStore, "get" | "set">;
  remoteServers: Pick<RemoteServerManager, "request" | "supportsCapability">;
}

export function providerDetectionIpcHandlers({
  detection,
  settings,
  remoteServers,
}: ProviderDetectionIpcDependencies): Pick<IpcGroupHandlers, "providerDetection"> {
  /** The renderer offers the host's scan only while the host serves `provider-detection-v1`. */
  async function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, PROVIDER_DETECTION_CAPABILITY))
      throw new Error(sourceText("error.team.providerDetectionUnsupported"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    providerDetection: {
      scanModelServers: scopedQueryHandler({
        local: () => Effect.runPromise(detection.scanModelServers()),
        remote: (serverId) =>
          remote(serverId, PROVIDER_DETECTION_ROUTES.scanModelServers, {}, decodeDetectedModelServers),
      }),
      scanAgents: scopedQueryHandler({
        local: () => Effect.runPromise(detection.scanAgents()),
        remote: (serverId) => remote(serverId, PROVIDER_DETECTION_ROUTES.scanAgents, {}, decodeDetectedAgents),
      }),
      discoverModels: scopedHandler(parseDiscoverModels, {
        local: (input) => Effect.runPromise(detection.discoverModels(input)),
        remote: (input, serverId) =>
          remote(serverId, PROVIDER_DETECTION_ROUTES.discoverModels, input, decodeDiscoveredModels),
      }),
      getSettings: scopedQueryHandler({
        local: () => settings.get(),
        remote: (serverId) => remote(serverId, PROVIDER_DETECTION_ROUTES.settings, {}, decodeDetectionSettings),
      }),
      setSettings: scopedHandler(parseProviderDetectionSettings, {
        local: (next) => runCauseEffect(settings.set(next)),
        remote: (next, serverId) =>
          remote(serverId, PROVIDER_DETECTION_ROUTES.updateSettings, next, decodeDetectionSettings),
      }),
    },
  };
}
