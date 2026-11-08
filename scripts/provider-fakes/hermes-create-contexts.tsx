import type {
  AgentProviderId,
  AgentStatus,
  ClientAgentModelOption,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import { createMemo } from "solid-js";
import type { useAuth as productionAuth } from "../../src/renderer/src/features/account/account-context";
import type { useAgentActions as productionActions } from "../../src/renderer/src/features/agents/agent-actions";
import type { useAgents as productionAgents } from "../../src/renderer/src/features/agents/agents-context";
import type { useCustomAgents as productionCustomAgents } from "../../src/renderer/src/features/custom-agents/custom-agents-context";
import type { useSetup as productionSetup } from "../../src/renderer/src/features/onboarding/onboarding-context";
import type { useServerSettings as productionServerSettings } from "../../src/renderer/src/features/servers/server-settings";
import type { useServers as productionServers } from "../../src/renderer/src/features/servers/servers-context";
import type { useProviders as productionProviders } from "../../src/renderer/src/providers";

interface CreateContext {
  draft: ReturnType<typeof productionAgents>["agentSetupDraft"];
  setDraft: ReturnType<typeof productionAgents>["setAgentSetupDraft"];
  status: AgentStatus;
  models: ClientAgentModelOption[];
  submit: ReturnType<typeof productionActions>["createAgent"];
  connect: (provider: AgentProviderId) => Promise<void>;
  runtimes: Partial<ReturnType<ReturnType<typeof productionProviders>["providerRuntimeStatuses"]>>;
  local: boolean;
  download: ReturnType<typeof productionProviders>["downloadProviderRuntime"];
  cancelDownload: ReturnType<typeof productionProviders>["cancelProviderRuntimeDownload"];
}

let current: CreateContext | undefined;

export function setCreateContext(value: CreateContext): void {
  current = value;
}

function context(): CreateContext {
  if (!current) throw new Error("The create fixture context is not set.");
  return current;
}

export function useAgents(): Pick<
  ReturnType<typeof productionAgents>,
  | "agentList"
  | "agentSetupDraft"
  | "setAgentSetupDraft"
  | "agentSetupError"
  | "creatingAgent"
  | "cancelAgentSetup"
  | "modelOptions"
  | "agentStatus"
  | "serverSetupChoice"
  | "developmentCreation"
> {
  const value = context();
  return {
    agentList: createMemo(() => []),
    agentSetupDraft: value.draft,
    setAgentSetupDraft: value.setDraft,
    agentSetupError: createMemo(() => null),
    creatingAgent: createMemo(() => false),
    cancelAgentSetup: () => {},
    modelOptions: createMemo(() => value.models),
    agentStatus: createMemo(() => value.status),
    serverSetupChoice: createMemo(() => null),
    developmentCreation: createMemo(() => ({ providerAvailable: () => false })),
  };
}

export function useAgentActions(): Pick<ReturnType<typeof productionActions>, "createAgent"> {
  return { createAgent: context().submit };
}

export function useSetup(): Pick<ReturnType<typeof productionSetup>, "setupState"> {
  return { setupState: createMemo(() => null) };
}

export function useCustomAgents(): Pick<ReturnType<typeof productionCustomAgents>, "customAgents"> {
  return { customAgents: createMemo(() => []) };
}

export function useServers(): Pick<
  ReturnType<typeof productionServers>,
  "activeServer" | "activeServerSupportsCapability"
> {
  return {
    activeServer: createMemo(() => ({
      id: "local",
      name: "Create fixture",
      kind: context().local ? "local" : "remote",
      state: "online",
      apiUrl: null,
      active: true,
      notificationsMuted: false,
      notificationsMutedUntil: null,
      notificationLevel: "all",
      remoteDesktopAvailable: false,
      logoUrl: null,
      role: null,
    })),
    activeServerSupportsCapability: () => true,
  };
}

export function useProviders(): Pick<
  ReturnType<typeof productionProviders>,
  | "providerRuntimeStatuses"
  | "providerRuntimeDownloadsAvailable"
  | "downloadProviderRuntime"
  | "cancelProviderRuntimeDownload"
  | "connectProvider"
  | "providerAdminServerId"
  | "activeCustomProviders"
> {
  const idle: ProviderRuntimeStatus = { phase: "not-downloaded", progress: null, message: null, version: null };
  return {
    providerRuntimeStatuses: createMemo(() => ({
      codex: idle,
      claude: idle,
      grok: idle,
      opencode: idle,
      antigravity: idle,
      cursor: idle,
      cline: idle,
      kimi: idle,
      pi: idle,
      muse: idle,
      devin: idle,
      copilot: idle,
      mistral: idle,
      ...context().runtimes,
    })),
    providerRuntimeDownloadsAvailable: createMemo(() => context().local),
    downloadProviderRuntime: context().download,
    cancelProviderRuntimeDownload: context().cancelDownload,
    connectProvider: context().connect,
    providerAdminServerId: createMemo(() => undefined),
    activeCustomProviders: createMemo(() => []),
  };
}

export function useServerSettings(): Pick<ReturnType<typeof productionServerSettings>, "openServerSettings"> {
  return { openServerSettings: () => {} };
}

export function useAuth(): Pick<ReturnType<typeof productionAuth>, "accountUsage"> {
  return { accountUsage: createMemo(() => null) };
}
