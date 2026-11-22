import {
  CUSTOM_PROVIDER_LIMITS,
  type CustomProviderHarness,
  type CustomProviderRestart,
  type SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import type { AppFormat } from "@openbot/i18n";
import type { AcpAgentCheck, CustomAcpAgentDraft } from "./custom-acp-agent-form";
import {
  type CustomProviderDraft,
  type CustomProviderEndpoint,
  type DiscoveredModel,
  savedHeaderDrafts,
  tokenCountText,
} from "./custom-provider-form";

interface DetectedBase {
  key: string;
  id: string;
  name: string;
  added?: boolean | undefined;
}

export type DetectedProvider =
  | (DetectedBase & {
      kind: "models";
      baseUrl: string;
      models: readonly DiscoveredModel[];
      savedModels?: readonly DiscoveredModel[] | undefined;
      keyStored?: boolean | undefined;
      savedHeaderNames?: readonly string[] | undefined;
      harness?: CustomProviderHarness | undefined;
    })
  | (DetectedBase & {
      kind: "agent";
      command: string;
      args: string;
      version?: string | undefined;
      envNames?: readonly string[] | undefined;
      usagePrompt?: string | null | undefined;
    });

export interface ProviderDetection {
  scanning: boolean;
  found: readonly DetectedProvider[];
  hidden?: number | undefined;
}

export type DetectedProviderValue =
  | { kind: "models"; value: SaveCustomProviderInput }
  | { kind: "agent"; value: CustomAcpAgentDraft };

export interface DetectedProviderApi {
  save: (provider: DetectedProvider, value: DetectedProviderValue) => Promise<CustomProviderRestart | undefined>;
  hide: (provider: DetectedProvider) => void;
  showHidden: () => void;
  scan?: (() => void) | undefined;
  discoverModels?: ((endpoint: CustomProviderEndpoint) => Promise<readonly DiscoveredModel[]>) | undefined;
  checkAgent?: ((value: CustomAcpAgentDraft, savedAgentId?: string) => Promise<AcpAgentCheck>) | undefined;
}

export function detectedLocation(provider: DetectedProvider): string {
  if (provider.kind === "agent") return provider.command;
  try {
    return new URL(provider.baseUrl).host;
  } catch {
    return provider.baseUrl;
  }
}

export function detectedModelsDraft(
  provider: Extract<DetectedProvider, { kind: "models" }>,
  format: Pick<AppFormat, "number">,
): CustomProviderDraft {
  const source = provider.added && provider.savedModels ? provider.savedModels : provider.models;
  const models = source.slice(0, CUSTOM_PROVIDER_LIMITS.models).map((model) => ({
    id: model.id,
    name: model.name ?? "",
    contextWindow: model.contextWindow === undefined ? "" : tokenCountText(model.contextWindow, format),
    maxOutput: model.maxOutput === undefined ? "" : tokenCountText(model.maxOutput, format),
    ...(model.reasoningEfforts ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
    ...(model.inputs ? { inputs: [...model.inputs] } : {}),
  }));
  return {
    providerId: provider.id,
    displayName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: "",
    models: models.length > 0 ? models : [{ id: "", name: "" }],
    headers: savedHeaderDrafts(provider.added ? provider.savedHeaderNames : undefined),
    ...(provider.added && provider.harness ? { harness: provider.harness } : {}),
  };
}

export function detectedAgentDraft(provider: Extract<DetectedProvider, { kind: "agent" }>): CustomAcpAgentDraft {
  const names = provider.added ? (provider.envNames ?? []) : [];
  return {
    agentId: provider.id,
    displayName: provider.name,
    command: provider.command,
    args: provider.args,
    env: names.length > 0 ? names.map((name) => ({ name, value: "", savedName: name })) : [{ name: "", value: "" }],
    usagePrompt: (provider.added && provider.usagePrompt) || "",
  };
}
