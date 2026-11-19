import {
  type CustomAgentSummary,
  type CustomProviderRestart,
  type CustomProviderSummary,
  customProviderEndpointKey,
  DEFAULT_PROVIDER_DETECTION_SETTINGS,
  type DetectedAcpAgent,
  type DetectedModelServer,
  type DiscoverModelsInput,
  type DiscoverModelsResult,
  detectedModelServerKey,
  type ProviderDetectionSettings,
} from "@openbot/contracts/ipc";
import { checkResult } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import {
  customAgentCheckInput,
  customAgentInput,
  formatAgentArgs,
} from "@openbot/ui/features/custom-providers/custom-acp-agent-form";
import { customProviderUpdate } from "@openbot/ui/features/custom-providers/custom-provider-form";
import type {
  DetectedProvider,
  DetectedProviderApi,
  ProviderDetection,
} from "@openbot/ui/features/custom-providers/detected-providers";
import type { ProviderDetectionSettingsValue } from "@openbot/ui/features/custom-providers/ProviderDetectionSettings";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import type { createCustomAgentsStore } from "../../custom-agents/stores/custom-agents-store";
import type { createCustomProvidersStore } from "./custom-providers-store";

const SETTINGS_SAVE_DELAY_MS = 400;

interface ProviderDetectionState {
  servers: DetectedModelServer[];
  agents: DetectedAcpAgent[];
  scanningServers: boolean;
  scanningAgents: boolean;
  settings: ProviderDetectionSettings | null;
  settingsError: string | null;
  scanned: boolean;
}

export interface ProviderDetectionCalls {
  scanModelServers: () => Promise<DetectedModelServer[]>;
  scanAgents: () => Promise<DetectedAcpAgent[]>;
  discoverModels: (input: DiscoverModelsInput) => Promise<DiscoverModelsResult>;
  getSettings: () => Promise<ProviderDetectionSettings>;
  setSettings: (settings: ProviderDetectionSettings) => Promise<ProviderDetectionSettings>;
}

type AgentsStore = ReturnType<typeof createCustomAgentsStore>;

interface ProviderDetectionStoreOptions {
  api: () => ProviderDetectionCalls | undefined;
  endpoints: Pick<
    ReturnType<typeof createCustomProvidersStore>,
    "customProviders" | "saveCustomProvider" | "updateCustomProvider"
  >;
  agents: Pick<AgentsStore, "customAgents" | "saveCustomAgent"> & Partial<Pick<AgentsStore, "checkCustomAgent">>;
}

function agentKey(command: string): string {
  return `agent:${command}`;
}

function savedEndpoint(
  server: DetectedModelServer,
  saved: readonly CustomProviderSummary[],
): CustomProviderSummary | undefined {
  const key = customProviderEndpointKey(server.baseUrl);
  return saved.find((provider) => key !== null && customProviderEndpointKey(provider.baseUrl) === key);
}

function savedAgent(found: DetectedAcpAgent, saved: readonly CustomAgentSummary[]): CustomAgentSummary | undefined {
  return saved.find((agent) => agent.resolvedCommand === found.command || agent.command === found.command);
}

function modelsRow(server: DetectedModelServer, saved: CustomProviderSummary | undefined): DetectedProvider {
  const base = { kind: "models" as const, key: detectedModelServerKey(server.baseUrl), models: server.models };
  if (!saved) return { ...base, id: server.id, name: server.name, baseUrl: server.baseUrl };
  return {
    ...base,
    id: saved.id,
    name: saved.name,
    baseUrl: saved.baseUrl,
    added: true,
    savedModels: saved.models.map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxOutput !== undefined ? { maxOutput: model.maxOutput } : {}),
      ...(model.reasoningEfforts !== undefined ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
      ...(model.inputs !== undefined ? { inputs: [...model.inputs] } : {}),
    })),
    keyStored: saved.hasApiKey,
    savedHeaderNames: saved.headerNames ?? [],
    ...(saved.harness ? { harness: saved.harness } : {}),
  };
}

function agentRow(found: DetectedAcpAgent, saved: CustomAgentSummary | undefined): DetectedProvider {
  const base = { kind: "agent" as const, key: agentKey(found.command), command: found.command };
  if (!saved) return { ...base, id: found.id, name: found.name, args: formatAgentArgs(found.args) };
  return {
    ...base,
    id: saved.id,
    name: saved.name,
    command: saved.command,
    args: formatAgentArgs(saved.args),
    added: true,
    envNames: saved.envNames,
    usagePrompt: saved.usagePrompt,
  };
}

export function createProviderDetectionStore(options: ProviderDetectionStoreOptions) {
  const [state, setState] = createStore<ProviderDetectionState>({
    servers: [],
    agents: [],
    scanningServers: false,
    scanningAgents: false,
    settings: null,
    settingsError: null,
    scanned: false,
  });
  let generation = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingRescan = false;
  let settingsLoad: Promise<ProviderDetectionSettings | null> | undefined;
  let lastSaved: ProviderDetectionSettings | null = null;
  let writes: Promise<void> = Promise.resolve();

  function settings(): ProviderDetectionSettings {
    return state.settings ?? DEFAULT_PROVIDER_DETECTION_SETTINGS;
  }

  function loadSettings(): Promise<ProviderDetectionSettings | null> {
    settingsLoad ??= (async () => {
      const group = options.api();
      if (!group) return null;
      try {
        const value = await group.getSettings();
        lastSaved = value;
        setState((current) => {
          current.settings = value;
        });
        return value;
      } catch {
        settingsLoad = undefined;
        return null;
      }
    })();
    return settingsLoad;
  }

  async function scan(): Promise<void> {
    const group = options.api();
    if (!group) return;
    generation += 1;
    const current = generation;
    await loadSettings();
    if (current !== generation) return;
    if (!settings().enabled) {
      setState((draft) => {
        draft.servers = [];
        draft.agents = [];
        draft.scanningServers = false;
        draft.scanningAgents = false;
        draft.scanned = true;
      });
      return;
    }
    setState((draft) => {
      draft.scanningServers = true;
      draft.scanningAgents = true;
      draft.scanned = true;
    });
    const servers = group
      .scanModelServers()
      .catch(() => [])
      .then((found) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.servers = found;
          draft.scanningServers = false;
        });
      });
    const agents = group
      .scanAgents()
      .catch(() => [])
      .then((found) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.agents = found;
          draft.scanningAgents = false;
        });
      });
    await Promise.all([servers, agents]);
  }

  function scanOnce(): void {
    if (!state.scanned) void scan();
  }

  function writeSettings(payload: () => ProviderDetectionSettings, listsChanged: boolean, rescan: boolean): void {
    const group = options.api();
    if (!group) return;
    setState((draft) => {
      draft.settingsError = null;
    });
    writes = writes.then(async () => {
      try {
        const value = payload();
        const saved = await group.setSettings({
          enabled: value.enabled,
          addresses: [...value.addresses],
          folders: [...value.folders],
          hiddenIds: [...value.hiddenIds],
        });
        lastSaved = saved;
        if (listsChanged && saveTimer === undefined) {
          setState((draft) => {
            draft.settings = saved;
          });
        }
        if (rescan) void scan();
      } catch (error) {
        setState((draft) => {
          const text = currentText();
          draft.settingsError = text.errorMessage(error, text.t("customProvider.detection.saveFailed"));
        });
      }
    });
  }

  function setSettings(value: ProviderDetectionSettingsValue): void {
    const next: ProviderDetectionSettings = {
      enabled: value.enabled,
      addresses: [...value.addresses],
      folders: [...value.folders],
      hiddenIds: [...settings().hiddenIds],
    };
    const before = settings();
    pendingRescan ||=
      before.enabled !== next.enabled ||
      before.addresses.join("\n") !== next.addresses.join("\n") ||
      before.folders.join("\n") !== next.folders.join("\n");
    setState((draft) => {
      draft.settings = next;
    });
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      const rescan = pendingRescan;
      pendingRescan = false;
      writeSettings(settings, true, rescan);
    }, SETTINGS_SAVE_DELAY_MS);
  }

  function setHidden(hiddenIds: string[]): void {
    setState((draft) => {
      draft.settings = { ...settings(), hiddenIds };
    });
    writeSettings(() => ({ ...(lastSaved ?? settings()), hiddenIds: settings().hiddenIds }), false, false);
  }

  function rows(): DetectedProvider[] {
    const endpoints = options.endpoints.customProviders();
    const agents = options.agents.customAgents();
    return [
      ...state.servers.map((server) => modelsRow(server, savedEndpoint(server, endpoints))),
      ...state.agents.map((agent) => agentRow(agent, savedAgent(agent, agents))),
    ];
  }

  function detection(): ProviderDetection {
    const hidden = new Set(settings().hiddenIds);
    const all = rows();
    const found = all.filter((row) => !hidden.has(row.key));
    return {
      scanning: state.scanningServers || state.scanningAgents,
      found,
      hidden: all.length - found.length,
    };
  }

  async function save(
    provider: DetectedProvider,
    value: Parameters<DetectedProviderApi["save"]>[1],
  ): Promise<CustomProviderRestart> {
    if (value.kind === "agent") return options.agents.saveCustomAgent(customAgentInput(value.value));
    if (provider.added) return options.endpoints.updateCustomProvider(customProviderUpdate(value.value));
    return options.endpoints.saveCustomProvider(value.value);
  }

  function agentCheck(): DetectedProviderApi["checkAgent"] {
    const check = options.agents.checkCustomAgent;
    if (!check) return undefined;
    return async (value, savedAgentId) => checkResult(await check(customAgentCheckInput(value, savedAgentId)));
  }

  const firstRunApi: DetectedProviderApi = {
    save,
    hide: (provider) => setHidden([...new Set([...settings().hiddenIds, provider.key])]),
    showHidden: () => setHidden([]),
    discoverModels: async (endpoint) => {
      const group = options.api();
      if (!group) throw new Error(currentText().t("customProvider.discovery.empty"));
      const result = await group.discoverModels({
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey?.trim() ? endpoint.apiKey : null,
        headers: endpoint.headers.filter((header) => header.name.trim()),
        ...(endpoint.savedProviderId === undefined ? {} : { savedProviderId: endpoint.savedProviderId }),
      });
      return result.models;
    },
    checkAgent: agentCheck(),
  };
  const api: DetectedProviderApi = { ...firstRunApi, scan: () => void scan() };

  return {
    detection,
    api,
    firstRunApi,
    scan,
    scanOnce,
    loadSettings,
    settingsValue: (): ProviderDetectionSettingsValue | null => state.settings,
    settingsError: () => state.settingsError,
    setSettings,
    takenAgentIds: () => options.agents.customAgents().map((agent) => agent.id),
  };
}
