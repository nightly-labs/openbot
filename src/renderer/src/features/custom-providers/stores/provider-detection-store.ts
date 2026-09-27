import {
  type CustomAgentSummary,
  type CustomProviderRestart,
  type CustomProviderSummary,
  customProviderEndpointKey,
  DEFAULT_PROVIDER_DETECTION_SETTINGS,
  type DetectedAcpAgent,
  type DetectedModelServer,
  detectedModelServerKey,
  type ProviderDetectionDesktopApi,
  type ProviderDetectionSettings,
  type SaveCustomProviderInput,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { checkResult } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import {
  customAgentCheckInput,
  customAgentInput,
  formatAgentArgs,
} from "@openbot/ui/features/custom-providers/custom-acp-agent-form";
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

/** A change to the lists is saved when the user stops typing, not on each key. */
const SETTINGS_SAVE_DELAY_MS = 400;

interface ProviderDetectionState {
  servers: DetectedModelServer[];
  agents: DetectedAcpAgent[];
  scanningServers: boolean;
  scanningAgents: boolean;
  /** Null until main answers, so the settings section does not show defaults it has not read. */
  settings: ProviderDetectionSettings | null;
  settingsError: string | null;
  scanned: boolean;
}

interface ProviderDetectionStoreOptions {
  api: () => ProviderDetectionDesktopApi | undefined;
  endpoints: Pick<
    ReturnType<typeof createCustomProvidersStore>,
    "customProviders" | "saveCustomProvider" | "updateCustomProvider"
  >;
  agents: Pick<ReturnType<typeof createCustomAgentsStore>, "customAgents" | "saveCustomAgent" | "checkCustomAgent">;
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
    savedModels: saved.models.map((model) => ({ id: model.id, name: model.name })),
    keyStored: saved.hasApiKey,
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
  };
}

/**
 * An update sends only what the user changed: a blank key and no headers keep the stored ones.
 * There is no way to clear them here, which is the rule of `customProviders.update`.
 */
function updateInput(value: SaveCustomProviderInput): UpdateCustomProviderInput {
  return {
    id: value.id,
    name: value.name,
    baseUrl: value.baseUrl,
    models: value.models,
    ...(value.apiKey === null ? {} : { apiKey: value.apiKey }),
    ...(value.headers.length === 0 ? {} : { headers: value.headers }),
  };
}

/**
 * What this computer found: local model servers and known ACP agent commands, with the saved ones
 * marked, and the settings of where to look. This computer only: a joined server's host is not
 * scanned from here.
 */
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
  /** A reply to an older scan must not replace the rows of a newer one. */
  let generation = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingRescan = false;
  let settingsLoad: Promise<ProviderDetectionSettings | null> | undefined;
  /** The value main last accepted. Its lists are valid, also while the user types one that is not. */
  let lastSaved: ProviderDetectionSettings | null = null;
  /** One write at a time, so the reply to an older write cannot replace what a newer one saved. */
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
        // A settings file this build cannot read still leaves a scan with the defaults.
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
    // Each source replaces its own rows when it answers, so a quick server list does not wait for
    // the agent lookup. A failed source finds nothing: detection is a help, not a requirement.
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

  /** First run scans once, however often the step renders. */
  function scanOnce(): void {
    if (!state.scanned) void scan();
  }

  /**
   * Saves the value that `payload` gives when the write starts. `listsChanged` is false for Hide
   * and Show hidden, whose reply must not replace lists that the user is still typing.
   */
  function writeSettings(payload: () => ProviderDetectionSettings, listsChanged: boolean, rescan: boolean): void {
    const group = options.api();
    if (!group) return;
    setState((draft) => {
      draft.settingsError = null;
    });
    writes = writes.then(async () => {
      try {
        const saved = await group.setSettings(payload());
        lastSaved = saved;
        // An edit made while this save ran is newer than its reply, and its own save follows.
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

  /** The switch and the lists. A new place to look scans again once the change is saved. */
  function setSettings(value: ProviderDetectionSettingsValue): void {
    const next: ProviderDetectionSettings = {
      enabled: value.enabled,
      addresses: [...value.addresses],
      folders: [...value.folders],
      hiddenIds: [...settings().hiddenIds],
    };
    const before = settings();
    // Each key press restarts the delay, so a change of place stays pending until the save runs.
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
      // The current value, not the one of the last key press: a Hide in the delay stays saved.
      writeSettings(settings, true, rescan);
    }, SETTINGS_SAVE_DELAY_MS);
  }

  /**
   * Hide and Show hidden are one click each, so they save at once, with the lists main last
   * accepted: a list the user is still typing may not be valid yet, and main refuses the whole write.
   */
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
    if (provider.added) return options.endpoints.updateCustomProvider(updateInput(value.value));
    return options.endpoints.saveCustomProvider(value.value);
  }

  /** First run scans once, so it has no scan-again control. */
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
    checkAgent: async (value, savedAgentId) =>
      checkResult(await options.agents.checkCustomAgent(customAgentCheckInput(value, savedAgentId))),
  };
  const api: DetectedProviderApi = { ...firstRunApi, scan: () => void scan() };

  return {
    detection,
    api,
    firstRunApi,
    scan,
    scanOnce,
    loadSettings,
    /** The switch and the lists, for the settings section. Null until main answers. */
    settingsValue: (): ProviderDetectionSettingsValue | null => state.settings,
    settingsError: () => state.settingsError,
    setSettings,
    takenAgentIds: () => options.agents.customAgents().map((agent) => agent.id),
  };
}
