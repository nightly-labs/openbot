// Local model servers and ACP agents that the host found without the user's help. The host owns the
// scan, the saves and the hidden list; these types only describe what it reports and what it does.

import {
  CUSTOM_PROVIDER_LIMITS,
  type CustomProviderRestart,
  type SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import type { AcpAgentCheck, CustomAcpAgentDraft } from "./custom-acp-agent-form";
import type { CustomProviderDraft, CustomProviderEndpoint, DiscoveredModel } from "./custom-provider-form";

interface DetectedBase {
  /** The detection key that Hide stores: `models:<endpoint key>` or `agent:<command path>`. */
  key: string;
  id: string;
  name: string;
  /** Already saved, so the row offers Edit instead of Add. */
  added?: boolean;
}

export type DetectedProvider =
  | (DetectedBase & {
      kind: "models";
      baseUrl: string;
      /** The list the server gave when the host asked it, so the form opens with them. */
      models: readonly DiscoveredModel[];
      /** For a saved endpoint: the models the user chose, which Edit opens with. */
      savedModels?: readonly DiscoveredModel[];
      /** For a saved endpoint: main holds a key or headers, which a blank key field keeps. */
      keyStored?: boolean;
    })
  | (DetectedBase & {
      kind: "agent";
      /** The full path that the host found, so the saved agent does not depend on PATH. */
      command: string;
      args: string;
      version?: string;
    });

/** `found` can grow while `scanning` is true. */
export interface ProviderDetection {
  scanning: boolean;
  found: readonly DetectedProvider[];
  /** Found, but hidden by the user. The host does not put them in `found`. */
  hidden?: number;
}

export type DetectedProviderValue =
  | { kind: "models"; value: SaveCustomProviderInput }
  | { kind: "agent"; value: CustomAcpAgentDraft };

/** What a host does with a detected provider. Each call leaves the renderer. */
export interface DetectedProviderApi {
  /**
   * Rejects with the reason, so the form stays open with what the user typed. A model server save
   * resolves with the restart state of the agents that use it.
   */
  save: (provider: DetectedProvider, value: DetectedProviderValue) => Promise<CustomProviderRestart | undefined>;
  hide: (provider: DetectedProvider) => void;
  showHidden: () => void;
  /** Without it there is no scan-again control, as on a first run that scans once. */
  scan?: () => void;
  discoverModels?: (endpoint: CustomProviderEndpoint) => Promise<readonly DiscoveredModel[]>;
  checkAgent?: (value: CustomAcpAgentDraft) => Promise<AcpAgentCheck>;
}

/** Where the provider is: a host and port for a server, the command for an agent. */
export function detectedLocation(provider: DetectedProvider): string {
  if (provider.kind === "agent") return provider.command;
  try {
    return new URL(provider.baseUrl).host;
  } catch {
    return provider.baseUrl;
  }
}

/**
 * The endpoint form for a server. A new server opens with the models it lists, up to the number an
 * endpoint can hold; a saved one opens with the models the user chose.
 */
export function detectedModelsDraft(provider: Extract<DetectedProvider, { kind: "models" }>): CustomProviderDraft {
  const source = provider.added && provider.savedModels ? provider.savedModels : provider.models;
  const models = source
    .slice(0, CUSTOM_PROVIDER_LIMITS.models)
    .map((model) => ({ id: model.id, name: model.name ?? "" }));
  return {
    providerId: provider.id,
    displayName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: "",
    models: models.length > 0 ? models : [{ id: "", name: "" }],
    headers: [{ name: "", value: "" }],
  };
}

export function detectedAgentDraft(provider: Extract<DetectedProvider, { kind: "agent" }>): CustomAcpAgentDraft {
  return {
    agentId: provider.id,
    displayName: provider.name,
    command: provider.command,
    args: provider.args,
    env: [{ name: "", value: "" }],
  };
}
