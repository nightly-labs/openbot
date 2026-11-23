import { type DetectedAcpAgent, isDetectedAcpAgent } from "../ipc-custom-agents";
import {
  type DetectedModelServer,
  type DiscoverModelsResult,
  isDetectedModelServer,
  isDiscoverModelsResult,
  isProviderDetectionSettings,
  type ProviderDetectionSettings,
} from "../ipc-provider-detection";
import { isDynamicRecord } from "../runtime-values";
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const PROVIDER_DETECTION_CAPABILITY = "provider-detection-v1";

export const PROVIDER_DETECTION_ROUTES = {
  settings: "/v1/admin/provider-detection/settings",
  updateSettings: "/v1/admin/provider-detection/settings/update",
  scanModelServers: "/v1/admin/provider-detection/scan-model-servers",
  scanAgents: "/v1/admin/provider-detection/scan-agents",
  discoverModels: "/v1/admin/provider-detection/discover-models",
} as const;

const model = fields(
  { id: identifier },
  {
    inputs: list(oneOf("image", "pdf"), 2),
    contextWindow: count,
    maxOutput: count,
    reasoningEfforts: list(oneOf("none", "minimal", "low", "medium", "high", "xhigh", "max"), 7),
  },
);
const models = list(model, 256);
const settings = fields({
  enabled: boolean,
  addresses: list(string(2048), 16),
  folders: list(string(2048), 16),
  hiddenIds: list(string(2048), 64),
});

export const PROVIDER_DETECTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_DETECTION_ROUTES.settings, adminRoute(empty, settings)],
  [PROVIDER_DETECTION_ROUTES.updateSettings, adminRoute(settings, settings)],
  [
    PROVIDER_DETECTION_ROUTES.scanModelServers,
    adminRoute(
      empty,
      fields({ servers: list(fields({ id: identifier, name: string(80), baseUrl: string(2048), models }), 64) }),
    ),
  ],
  [
    PROVIDER_DETECTION_ROUTES.scanAgents,
    adminRoute(
      empty,
      fields({
        agents: list(
          fields({ id: identifier, name: string(80), command: string(1024), args: list(string(1024), 32) }),
          64,
        ),
      }),
    ),
  ],
  [
    PROVIDER_DETECTION_ROUTES.discoverModels,
    adminRoute(
      fields(
        {
          baseUrl: string(2048),
          apiKey: nullable(string(4096)),
          headers: list(fields({ name: string(128), value: string(4096) }), 32),
        },
        { savedProviderId: identifier },
      ),
      fields({ models }),
    ),
  ],
]);

export function decodeDetectedModelServers(value: unknown): DetectedModelServer[] {
  const servers = isDynamicRecord(value) ? value.servers : undefined;
  if (!Array.isArray(servers) || !servers.every(isDetectedModelServer)) throw new Error("Invalid model server list.");
  return servers;
}

export function decodeDetectedAgents(value: unknown): DetectedAcpAgent[] {
  const agents = isDynamicRecord(value) ? value.agents : undefined;
  if (!Array.isArray(agents) || !agents.every(isDetectedAcpAgent)) throw new Error("Invalid agent list.");
  return agents;
}

export function decodeDiscoveredModels(value: unknown): DiscoverModelsResult {
  if (!isDiscoverModelsResult(value)) throw new Error("Invalid model list.");
  return value;
}

export function decodeDetectionSettings(value: unknown): ProviderDetectionSettings {
  if (!isProviderDetectionSettings(value)) throw new Error("Invalid detection settings.");
  return value;
}
