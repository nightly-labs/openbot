import {
  type AgentProviderId,
  type AgentStatus,
  type AppSetupState,
  type ClientAgentModelOption,
  type CustomProviderRestart,
  type CustomProviderSummary,
  isManagedRuntimeProvider,
  type ProviderAccountPool,
  type ProviderAccountPoolStrategy,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
  type ServerSummary,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import type { ProviderDetection } from "@openbot/ui/features/custom-providers/detected-providers";
import type { ProviderDetectionSettingsValue } from "@openbot/ui/features/custom-providers/ProviderDetectionSettings";
import type { ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createProviderRuntimeStore } from "../src/features/provider-updates/provider-runtime-store";
import { ServerSettingsModal } from "../src/features/servers/ServerSettingsModal";
import type { HostProviderSettings } from "../src/features/settings/ProviderSettingsSection";
import { STORY_HOST_STATUS, STORY_INVITES, STORY_PRESENCE, STORY_SERVERS } from "../src/preview/fixtures";
import { createStoryDetection, STORY_DETECTED_PROVIDERS } from "./detected-providers-fixture";
import { createMockOpenBot } from "./mock-openbot";
import { createFakeConnection } from "./provider-connection-fixture";
import { SettingsPageStory } from "./settings-page-story";

const localServer = localStoryServer();
const teamServer = STORY_SERVERS.find((candidate) => candidate.kind === "remote") ?? localServer;

const providerAgentStatus: AgentStatus = {
  phase: "blocked",
  cliVersion: null,
  auth: { kind: "unknown" },
  providers: (["codex", "claude", "grok", "opencode"] as const).map((id) => ({
    id,
    state: "not-installed",
    version: null,
    message: null,
  })),
  capabilities: { chat: "unavailable", browser: "ready", computerUse: "ready" },
  message: null,
  fullAccess: true,
};
const providerRuntimeStatuses: ProviderRuntimeSnapshot["providers"] = {
  codex: { phase: "downloading", progress: 24, message: null, version: null },
  claude: { phase: "downloading", progress: 48, message: null, version: null },
  grok: { phase: "downloading", progress: 72, message: null, version: null },
  opencode: { phase: "downloading", progress: 96, message: null, version: null },
  antigravity: { phase: "downloading", progress: 12, message: null, version: null },
  cursor: { phase: "not-downloaded", progress: null, message: null, version: null },
  cline: { phase: "not-downloaded", progress: null, message: null, version: null },
  kimi: { phase: "not-downloaded", progress: null, message: null, version: null },
  pi: { phase: "not-downloaded", progress: null, message: null, version: null },
  muse: { phase: "not-downloaded", progress: null, message: null, version: null },
  devin: { phase: "not-downloaded", progress: null, message: null, version: null },
  copilot: { phase: "not-downloaded", progress: null, message: null, version: null },
  mistral: { phase: "not-downloaded", progress: null, message: null, version: null },
};

const providerUpdateAgentStatus: AgentStatus = {
  ...providerAgentStatus,
  phase: "ready",
  providers: (["codex", "claude", "grok", "opencode"] as const).map((id) => ({
    id,
    state: "available",
    version: id === "claude" ? "2.1.246" : "1.0.0",
    message: null,
  })),
};
const firstDownloadAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: (providerUpdateAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex" ? { ...provider, state: "not-installed", version: null } : provider,
  ),
};
const openCodeInstalledAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: [
    ...(providerUpdateAgentStatus.providers ?? []),
    { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null },
  ],
};
const devinAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: [
    ...(providerUpdateAgentStatus.providers ?? []),
    { id: "devin", state: "available", version: "3000.11.234", message: null },
  ],
};
function devinModel(id: string, name: string): ClientAgentModelOption {
  return {
    provider: "devin",
    id,
    name,
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };
}
const DEVIN_MODELS: ClientAgentModelOption[] = [
  devinModel("gpt-6-2-astra-medium", "GPT-6.2 Astra"),
  devinModel("gpt-6-1-sol-medium", "GPT-6.1 Sol"),
  devinModel("fusion-gpt-6-2-astra-high-thinking-swe-2-medium", "Fusion (GPT-6.2 Astra High Thinking + SWE-2 Medium)"),
  devinModel("fusion-gpt-6-2-sol-high-thinking-swe-2-medium", "Fusion (GPT-6.2 Sol High Thinking + SWE-2 Medium)"),
  devinModel(
    "fusion-gpt-6-2-astra-high-thinking-gpt-5-6-luna-high",
    "Fusion (GPT-6.2 Astra High Thinking + GPT-5.6 Luna High)",
  ),
  devinModel(
    "fusion-gpt-6-2-sol-high-thinking-gpt-6-1-terra-high",
    "Fusion (GPT-6.2 Sol High Thinking + GPT-6.1 Terra High)",
  ),
  devinModel("fusion-gpt-6-2-astra-high-thinking-glm-5-2-high", "Fusion (GPT-6.2 Astra High Thinking + GLM-5.2 High)"),
];
const usageResetAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: (providerUpdateAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex"
      ? {
          ...provider,
          accounts: [
            { id: "default", label: null, email: "ada@example.com", state: "connected", message: null },
            { id: "a0123456789abcdef", label: "Work", email: "ada@work.example", state: "connected", message: null },
          ],
        }
      : provider,
  ),
};
const accountCodeAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: [
    ...(providerUpdateAgentStatus.providers ?? []).filter((provider) => provider.id !== "claude"),
    {
      id: "claude",
      state: "available",
      version: "2.1.0",
      message: null,
      accounts: [{ id: "default", label: null, email: "ada@example.com", state: "connected", message: null }],
    },
  ],
};
function createUsageResetAccounts(): ProviderAccountActions {
  let available = 2;
  return {
    connect: fn(async () => undefined),
    cancel: fn(async () => undefined),
    rename: fn(async () => undefined),
    remove: fn(async () => undefined),
    usageResets: async (provider) =>
      provider === "codex"
        ? [
            { provider, accountId: "default", available },
            { provider, accountId: "a0123456789abcdef", available: 0 },
          ]
        : [],
    resetUsage: fn(async () => {
      await new Promise((done) => setTimeout(done, 600));
      available -= 1;
      return "reset" as const;
    }),
  };
}

function createPoolAccounts() {
  const [pool, setPool] = createSignal<ProviderAccountPool | undefined>(undefined);
  const accounts = usageResetAgentStatus.providers?.find((provider) => provider.id === "codex")?.accounts ?? [];
  const actions: ProviderAccountActions = {
    connect: fn(async () => undefined),
    cancel: fn(async () => undefined),
    rename: fn(async () => undefined),
    remove: fn(async () => undefined),
    setPool: fn(
      async (
        _provider: AgentProviderId,
        enabled: boolean,
        leftOut: readonly string[],
        strategy?: ProviderAccountPoolStrategy,
      ) => {
        const inUse = accounts.find((account) => !leftOut.includes(account.id))?.id ?? null;
        const kept = strategy ?? pool()?.strategy;
        setPool(enabled ? { leftOut: [...leftOut], inUse, ...(kept ? { strategy: kept } : {}) } : undefined);
      },
    ),
    poolStrategy: true,
  };
  const agentStatus = (): AgentStatus => ({
    ...usageResetAgentStatus,
    providers: (usageResetAgentStatus.providers ?? []).map((provider) => {
      const current = pool();
      return provider.id === "codex" && current ? { ...provider, accountPool: current } : provider;
    }),
  });
  return { actions, agentStatus };
}

const codeSignInAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: (providerUpdateAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex"
      ? { ...provider, state: "sign-in-required", version: "0.149.1", message: "Connect ChatGPT to continue." }
      : provider,
  ),
};
const hostCodexKeyAgentStatus: AgentStatus = {
  ...codeSignInAgentStatus,
  providers: (codeSignInAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex" ? { ...provider, state: "available", message: null } : provider,
  ),
};
function hostCodexKeys(codex: "missing" | "saved"): ProviderKeyApi {
  return {
    readsCodexKey: true,
    onHost: true,
    getProviderApiKeyState: async (provider) => ({ provider, status: provider === "codex" ? codex : "missing" }),
    setProviderApiKey: fn(async () => undefined),
    clearProviderApiKey: fn(async () => undefined),
    openExternal: fn(async () => undefined),
  };
}
const STORY_CUSTOM_PROVIDERS: readonly CustomProviderSummary[] = [
  {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    hasApiKey: false,
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
  },
  {
    id: "house-router",
    name: "House Router",
    baseUrl: "https://models.example.com/v1",
    hasApiKey: true,
    models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
  },
];
const STORY_HOST_CUSTOM_PROVIDERS: readonly CustomProviderSummary[] = [
  {
    id: "aperture",
    name: "Aperture",
    baseUrl: "https://aperture.example.com/v1",
    hasApiKey: true,
    headerNames: ["X-Tenant"],
    models: [
      { id: "qwen3-coder", name: "Qwen3 Coder" },
      { id: "glm-4.6", name: "GLM 4.6" },
    ],
    harness: "pi",
  },
];
const providerUpdateRuntimeStatuses: ProviderRuntimeSnapshot["providers"] = {
  codex: { phase: "ready", progress: 100, message: null, version: "0.149.1" },
  claude: { phase: "ready", progress: 100, message: null, version: "2.1.246", availableVersion: "2.1.250" },
  grok: { phase: "ready", progress: 100, message: null, version: "1.0.5" },
  opencode: { phase: "ready", progress: 100, message: null, version: "1.18.30" },
  antigravity: { phase: "ready", progress: 100, message: null, version: "1.2.1" },
  cursor: { phase: "ready", progress: 100, message: null, version: "2026.09.28-64d2043" },
  cline: { phase: "ready", progress: 100, message: null, version: "3.0.68" },
  kimi: { phase: "ready", progress: 100, message: null, version: "1.52.0" },
  pi: { phase: "ready", progress: 100, message: null, version: "3.0.68" },
  muse: { phase: "ready", progress: 100, message: null, version: "3.0.68" },
  devin: { phase: "ready", progress: 100, message: null, version: "3000.11.234" },
  copilot: { phase: "ready", progress: 100, message: null, version: "1.0.105" },
  mistral: { phase: "ready", progress: 100, message: null, version: "3.1.0" },
};

function ServerProvidersStory(props: {
  providerDownloads?: boolean;
  providerUpdate?: boolean;
  providerUpdateFailure?: boolean;
  providerFirstDownload?: boolean;
  openCodeInstalled?: boolean;
  customProviderList?: boolean;
  codeSignIn?: boolean;
  detection?: ProviderDetection;
  hiddenDetected?: readonly string[];
  detectionSettings?: ProviderDetectionSettingsValue;
  inactive?: boolean;
  offProviders?: readonly AgentProviderId[];
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>>;
  usageReset?: boolean;
  accountPool?: boolean;
  accountCode?: boolean;
  hermes?: ProviderRuntimeStatus | null;
  hostCodexKey?: "missing" | "saved";
  hostCustomProviders?: "edit" | "remove-only";
  devinModels?: boolean;
}) {
  const usageResetAccounts = props.usageReset ? createUsageResetAccounts() : undefined;
  const poolAccounts = props.accountPool ? createPoolAccounts() : undefined;
  const hermes = props.hermes;
  const hermesAgentStatus: AgentStatus | undefined =
    hermes === undefined
      ? undefined
      : {
          ...providerAgentStatus,
          providers: [
            ...(providerAgentStatus.providers ?? []),
            {
              id: "hermes",
              state: hermes?.phase === "ready" ? "sign-in-required" : "not-installed",
              version: hermes?.phase === "ready" ? hermes.version : null,
              message: null,
            },
          ],
        };
  const previousApi = window.openbot;
  const mock = createMockOpenBot({
    ...(props.providerUpdate
      ? {
          providerRuntimeSnapshot: {
            revision: 0,
            providers: props.providerFirstDownload
              ? {
                  ...providerUpdateRuntimeStatuses,
                  codex: { phase: "not-downloaded", progress: null, message: null, version: null },
                  claude: { phase: "ready", progress: 100, message: null, version: "2.1.246" },
                }
              : providerUpdateRuntimeStatuses,
            toolRuntimes: { bun: { phase: "ready", progress: 100, message: null, version: "1.4.2" } },
          },
        }
      : {}),
    ...(props.providerUpdateFailure ? { providerRuntimeFailure: true } : {}),
    ...(props.devinModels ? { models: DEVIN_MODELS } : {}),
  });
  const runtimes = createProviderRuntimeStore(() => (props.providerUpdate ? mock.api.providerRuntimes : undefined));
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    toast.dismiss();
    window.openbot = previousApi;
  });
  const [preference, setPreference] = createSignal<AppSetupState>({
    completed: true,
    preferredProvider: "codex",
    preferredModel: null,
  });
  const [open, setOpen] = createSignal(true);
  const codeConnection = createFakeConnection({ browser: fn(), finishAfterMs: 0 });
  const browserConnection = createFakeConnection({ browser: fn(), alternative: [] });
  const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>(
    props.hostCustomProviders
      ? [...STORY_HOST_CUSTOM_PROVIDERS]
      : props.customProviderList
        ? [...STORY_CUSTOM_PROVIDERS]
        : [],
  );
  const [detectionSettings, setDetectionSettings] = createSignal(props.detectionSettings);
  const [offProviders, setOffProviders] = createSignal(props.offProviders);
  const detection = props.detection
    ? createStoryDetection(props.detection, {
        hidden: props.hiddenDetected,
        rescan: true,
        onSaved: (saved) => {
          if (saved.kind !== "models") return;
          const { id, name, baseUrl, apiKey, models } = saved.value;
          setCustomProviders((current) => [
            ...current.filter((provider) => provider.id !== id),
            { id, name, baseUrl, models, hasApiKey: Boolean(apiKey) },
          ]);
        },
      })
    : undefined;

  async function addCustomProvider(): Promise<CustomProviderRestart> {
    return "restarted";
  }

  async function deleteCustomProvider(id: string): Promise<CustomProviderRestart> {
    setCustomProviders((current) => current.filter((provider) => provider.id !== id));
    return "restarted";
  }

  async function updateCustomProvider(input: UpdateCustomProviderInput): Promise<CustomProviderRestart> {
    setCustomProviders((current) =>
      current.map((provider) =>
        provider.id === input.id
          ? {
              ...provider,
              name: input.name,
              baseUrl: input.baseUrl,
              models: input.models,
              hasApiKey: provider.hasApiKey || Boolean(input.apiKey),
            }
          : provider,
      ),
    );
    return "restarted";
  }

  const switchToManageProviders = props.inactive ? fn() : undefined;
  function storyServer(): ServerSummary {
    if (props.hostCodexKey || props.hostCustomProviders) return { ...teamServer, active: true };
    return props.inactive ? { ...localServer, active: false } : localServer;
  }

  function providerOptions(): HostProviderSettings | undefined {
    if (props.inactive) return undefined;
    return {
      get defaultProvider() {
        return {
          ...preference(),
          save: async (provider: AgentProviderId, model?: string | null) => {
            setPreference((current) => ({
              completed: true,
              preferredProvider: provider,
              preferredModel:
                model === undefined && current.preferredProvider === provider
                  ? current.preferredModel
                  : (model ?? null),
            }));
          },
        };
      },
      get agentStatus() {
        if (hermesAgentStatus) return hermesAgentStatus;
        if (poolAccounts) return poolAccounts.agentStatus();
        if (props.accountCode) return accountCodeAgentStatus;
        if (props.devinModels) return devinAgentStatus;
        if (props.hostCodexKey) return props.hostCodexKey === "saved" ? hostCodexKeyAgentStatus : codeSignInAgentStatus;
        return props.usageReset
          ? usageResetAgentStatus
          : props.codeSignIn
            ? codeSignInAgentStatus
            : props.providerFirstDownload
              ? firstDownloadAgentStatus
              : props.providerUpdate
                ? providerUpdateAgentStatus
                : props.openCodeInstalled
                  ? openCodeInstalledAgentStatus
                  : providerAgentStatus;
      },
      connection:
        props.codeSignIn || props.accountCode || hermes !== undefined
          ? codeConnection
          : props.providerDownloads || props.providerUpdate
            ? browserConnection
            : undefined,
      get providerRuntimeStatuses() {
        if (hermes !== undefined) return hermes ? { ...providerRuntimeStatuses, hermes } : providerRuntimeStatuses;
        return props.providerUpdate
          ? runtimes.providerRuntimeStatuses()
          : props.providerDownloads
            ? providerRuntimeStatuses
            : undefined;
      },
      get providerAvailableVersions() {
        return props.providerUpdate ? runtimes.providerAvailableVersions() : undefined;
      },
      onUpdateProvider: props.providerUpdate ? runtimes.downloadProviderRuntime : undefined,
      onDownloadProvider: props.providerUpdate
        ? runtimes.downloadProviderRuntime
        : props.providerDownloads || hermes !== undefined
          ? fn()
          : undefined,
      onCancelProviderDownload: props.providerUpdate
        ? runtimes.cancelProviderRuntimeDownload
        : props.providerDownloads || hermes !== undefined
          ? fn()
          : undefined,
      accountActions: props.accountCode
        ? {
            connect: fn(async () => undefined),
            cancel: fn(async () => undefined),
            rename: fn(async () => undefined),
            remove: fn(async () => undefined),
            connectWithCode: async (provider) => codeConnection.alternative(provider),
            pasteCodeSignIn: true,
          }
        : (poolAccounts?.actions ?? usageResetAccounts),
      providerKeys: props.hostCodexKey ? hostCodexKeys(props.hostCodexKey) : undefined,
      onAddCustomProvider: addCustomProvider,
      onDeleteCustomProvider: deleteCustomProvider,
      onUpdateCustomProvider: props.hostCustomProviders === "remove-only" ? undefined : updateCustomProvider,
      get customProviders() {
        return customProviders();
      },
      get providerDetection() {
        return detection?.detection();
      },
      detectedProviderApi: detection?.api,
      get detectionSettings() {
        return detectionSettings();
      },
      onDetectionSettingsChange: setDetectionSettings,
      get offProviders() {
        return offProviders();
      },
      providerUsers: props.providerUsers,
      onSetProviderOn: props.offProviders
        ? (provider: AgentProviderId, on: boolean) => {
            setOffProviders((current = []) => (on ? current.filter((id) => id !== provider) : [...current, provider]));
          }
        : undefined,
      onMeasureProviderDownload:
        props.offProviders && props.providerUpdate
          ? async (provider: AgentProviderId) =>
              isManagedRuntimeProvider(provider)
                ? await mock.api.providerRuntimes.measureDownload(provider)
                : { bytes: 0, versions: 0 }
          : undefined,
      onRemoveProviderDownload:
        props.offProviders && props.providerUpdate
          ? async (provider: AgentProviderId) => {
              if (!isManagedRuntimeProvider(provider)) return;
              runtimes.applyProviderRuntimeSnapshot(await mock.api.providerRuntimes.removeDownload(provider));
            }
          : undefined,
    };
  }

  return (
    <>
      <SettingsPageStory title="Server settings" onEscape={() => setOpen(false)}>
        {(page) => (
          <ServerSettingsModal
            page={page()}
            open={open()}
            platform="darwin"
            server={storyServer()}
            hostStatus={STORY_HOST_STATUS}
            members={STORY_PRESENCE.members}
            invites={STORY_INVITES}
            onRetry={fn(async () => undefined)}
            onSaveIdentity={fn(async () => undefined)}
            onSetPublished={fn(async () => undefined)}
            onCreateInvite={fn(async () => {
              throw new Error("Not used in this story.");
            })}
            onUpdateMember={fn(async () => undefined)}
            onRemoveMember={fn(async () => undefined)}
            onRevokeInvite={fn(async () => undefined)}
            onOpenScreenRecordingSettings={fn(async () => undefined)}
            onRecheckScreenRecording={fn(async () => undefined)}
            initialSection="providers"
            hostPromptCacheTtl={{}}
            claudeUserSetup={{}}
            claudeCompactWindow={{}}
            providerEnvironment={{}}
            hostModelVisibility={{}}
            onSwitchToManageProviders={switchToManageProviders}
            providers={providerOptions()}
          />
        )}
      </SettingsPageStory>
      <Toaster />
    </>
  );
}

const meta = {
  title: "Settings/ServerSettingsModal/Providers",
  component: ServerProvidersStory,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        serverDesktop: {
          name: "Server settings — 1200 × 820",
          styles: { width: "1200px", height: "820px" },
        },
        serverPhone: {
          name: "Server settings — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
} satisfies Meta<typeof ServerProvidersStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AddCustomProvider: Story = {
  render: () => <ServerProvidersStory openCodeInstalled />,
};

export const DetectingProviders: Story = {
  render: () => (
    <ServerProvidersStory
      openCodeInstalled
      detection={{ scanning: true, found: STORY_DETECTED_PROVIDERS.slice(0, 1) }}
    />
  ),
};

export const DetectedProviders: Story = {
  render: () => (
    <ServerProvidersStory
      openCodeInstalled
      detection={{
        scanning: false,
        found: STORY_DETECTED_PROVIDERS.map((provider) =>
          provider.id === "ollama" ? { ...provider, added: true } : provider,
        ),
      }}
    />
  ),
};

export const HiddenDetectedProviders: Story = {
  render: () => (
    <ServerProvidersStory
      openCodeInstalled
      detection={{ scanning: false, found: STORY_DETECTED_PROVIDERS }}
      hiddenDetected={["models:http://127.0.0.1:1234/v1"]}
    />
  ),
};

export const DetectionSettings: Story = {
  render: () => (
    <ServerProvidersStory
      openCodeInstalled
      detection={{ scanning: false, found: STORY_DETECTED_PROVIDERS }}
      detectionSettings={{
        enabled: true,
        addresses: ["http://192.168.1.20:11434/v1"],
        folders: ["~/tools/bin"],
      }}
    />
  ),
};

export const NothingDetected: Story = {
  render: () => <ServerProvidersStory openCodeInstalled detection={{ scanning: false, found: [] }} />,
};

export const CustomProviderList: Story = {
  render: () => <ServerProvidersStory openCodeInstalled customProviderList />,
};

export const CodeSignIn: Story = {
  render: () => <ServerProvidersStory codeSignIn />,
};

export const HostCodexKey: Story = {
  render: () => <ServerProvidersStory hostCodexKey="missing" />,
};

export const HostCodexKeySaved: Story = {
  render: () => <ServerProvidersStory hostCodexKey="saved" />,
};

export const HostCustomProviderEdit: Story = {
  render: () => <ServerProvidersStory openCodeInstalled hostCustomProviders="edit" />,
};

export const HostCustomProviderRemoveOnly: Story = {
  render: () => <ServerProvidersStory openCodeInstalled hostCustomProviders="remove-only" />,
};

export const ProviderDownloads: Story = {
  render: () => <ServerProvidersStory providerDownloads />,
  parameters: { viewport: { defaultViewport: "serverPhone" } },
};

export const ProviderUpdateAvailable: Story = {
  render: () => <ServerProvidersStory providerUpdate />,
};

export const ProviderUpdateRetry: Story = {
  render: () => <ServerProvidersStory providerUpdate providerUpdateFailure />,
};

export const ProviderFirstDownload: Story = {
  render: () => <ServerProvidersStory providerUpdate providerFirstDownload />,
};

export const ProvidersOff: Story = {
  render: () => (
    <ServerProvidersStory
      providerUpdate
      offProviders={["cursor", "antigravity", "cline"]}
      providerUsers={{ codex: ["Ada"], claude: ["Rex", "Mila"] }}
    />
  ),
};

export const CodexUsageReset: Story = {
  render: () => <ServerProvidersStory usageReset />,
};

export const AccountPool: Story = {
  render: () => <ServerProvidersStory accountPool />,
};

export const AccountCodeSignIn: Story = {
  render: () => <ServerProvidersStory accountCode />,
};

export const HermesInstallGuide: Story = {
  render: () => <ServerProvidersStory hermes={null} />,
};

export const HermesDownload: Story = {
  render: () => (
    <ServerProvidersStory hermes={{ phase: "not-downloaded", progress: null, message: null, version: null }} />
  ),
};

export const HermesInstalling: Story = {
  render: () => <ServerProvidersStory hermes={{ phase: "downloading", progress: 25, message: null, version: null }} />,
};

export const HermesConnect: Story = {
  render: () => <ServerProvidersStory hermes={{ phase: "ready", progress: 100, message: null, version: "0.22.7" }} />,
};

export const DevinModels: Story = {
  render: () => <ServerProvidersStory devinModels />,
};

export const NotSelectedServer: Story = {
  render: () => <ServerProvidersStory inactive />,
};

function localStoryServer(): ServerSummary {
  const server = STORY_SERVERS.find((candidate) => candidate.kind === "local");
  if (!server) throw new Error("Story server fixtures need a local server.");
  return server;
}
