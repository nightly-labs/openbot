import {
  type AgentProviderId,
  type AgentStatus,
  type AppSetupState,
  type CustomProviderRestart,
  type CustomProviderSummary,
  isManagedRuntimeProvider,
  type ProviderAccountPool,
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

/** Four connected runtimes, one of which has a newer version waiting. */
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
/** The same, before Codex has a CLI. */
const firstDownloadAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: (providerUpdateAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex" ? { ...provider, state: "not-installed", version: null } : provider,
  ),
};
/** OpenCode installed with no account of its own: enough to run an endpoint that brings its own key. */
const openCodeInstalledAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: [
    ...(providerUpdateAgentStatus.providers ?? []),
    { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null },
  ],
};
/** Codex with two connected accounts. Codex gave the own sign-in two usage resets, and the other none. */
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
/** A reset spends one credit after a short wait, so the dialog shows its pending state. */
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

/**
 * Codex accounts that the pool can share. The switch turns the pool on, and the ⋯ menu of an account
 * leaves it out or puts it back. The first account in the pool is in use.
 */
function createPoolAccounts() {
  const [pool, setPool] = createSignal<ProviderAccountPool | undefined>(undefined);
  const accounts = usageResetAgentStatus.providers?.find((provider) => provider.id === "codex")?.accounts ?? [];
  const actions: ProviderAccountActions = {
    connect: fn(async () => undefined),
    cancel: fn(async () => undefined),
    rename: fn(async () => undefined),
    remove: fn(async () => undefined),
    setPool: fn(async (_provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]) => {
      const inUse = accounts.find((account) => !leftOut.includes(account.id))?.id ?? null;
      setPool(enabled ? { leftOut: [...leftOut], inUse } : undefined);
    }),
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

/** ChatGPT installed and signed out, so its row offers both ways in. The rest are connected. */
const codeSignInAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: (providerUpdateAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex"
      ? { ...provider, state: "sign-in-required", version: "0.149.1", message: "Connect ChatGPT to continue." }
      : provider,
  ),
};
/**
 * Codex on a joined server with `codex-api-key-v1`, logged in with an OpenAI API key. The host status
 * does not carry the key, so only the key route says it is saved.
 */
const hostCodexKeyAgentStatus: AgentStatus = {
  ...codeSignInAgentStatus,
  providers: (codeSignInAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex" ? { ...provider, state: "available", message: null } : provider,
  ),
};
/** The key routes of a joined server's host that logs Codex in with a pasted OpenAI key. */
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
/** Two saved endpoints: one with a key of its own, one on this computer that asks for none. */
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
/**
 * The endpoints of a joined server's host, as `custom-provider-edit-v1` lists them: each one names its
 * harness and its header names. The model limits stay on the host.
 */
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

/** The Providers section of Server settings, with the providers of this computer. */
function ServerProvidersStory(props: {
  providerDownloads?: boolean;
  providerUpdate?: boolean;
  providerUpdateFailure?: boolean;
  /** Codex has no CLI yet. Needs `providerUpdate`, which gives the real runtime store. */
  providerFirstDownload?: boolean;
  openCodeInstalled?: boolean;
  customProviderList?: boolean;
  codeSignIn?: boolean;
  /** The first result of a fake scan. Scan again runs the whole scan. */
  detection?: ProviderDetection;
  /** Detected IDs that the user hid in an earlier run. */
  hiddenDetected?: readonly string[];
  /** Where the scan looks. Without it the section has no detection settings. */
  detectionSettings?: ProviderDetectionSettingsValue;
  /** A server that the window has not selected: the section offers the switch. */
  inactive?: boolean;
  /** Providers the user turned off. With it every provider row has the switch that turns one on or off. */
  offProviders?: readonly AgentProviderId[];
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>>;
  /** Codex accounts with usage reset credits: the account ⋯ menu offers Reset usage. */
  usageReset?: boolean;
  /** Codex accounts that the pool can share. */
  accountPool?: boolean;
  /**
   * The Hermes row: `null` is a host that sends no installer status, so the row opens the install
   * guide. A status is the Download, its progress, or an installed Hermes that offers Connect.
   */
  hermes?: ProviderRuntimeStatus | null;
  /** A joined server whose host logs Codex in with an OpenAI key: before the key, or with it. */
  hostCodexKey?: "missing" | "saved";
  /**
   * A joined server with saved endpoints: `edit` is a host with `custom-provider-edit-v1`, and
   * `remove-only` is an older host, which offers Remove only.
   */
  hostCustomProviders?: "edit" | "remove-only";
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
                  // No update offer here: its notification would cover the one for the download.
                  claude: { phase: "ready", progress: 100, message: null, version: "2.1.246" },
                }
              : providerUpdateRuntimeStatuses,
            toolRuntimes: { bun: { phase: "ready", progress: 100, message: null, version: "1.4.2" } },
          },
        }
      : {}),
    ...(props.providerUpdateFailure ? { providerRuntimeFailure: true } : {}),
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
        // A saved server joins the saved endpoints, as the host's list would report it.
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

  /** A key that is not sent stays saved, as in main. */
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

  // Named values, not ternary props: the modal reads its props in effect callbacks, where a
  // compiled ternary prop cannot create its memo.
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
        props.codeSignIn || hermes !== undefined
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
      accountActions: poolAccounts?.actions ?? usageResetAccounts,
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

/** The row that adds a self-described endpoint. OpenCode is installed, so the row offers Add. */
export const AddCustomProvider: Story = {
  render: () => <ServerProvidersStory openCodeInstalled />,
};

/** The Providers section looks for local model servers and ACP agents each time it opens. */
export const DetectingProviders: Story = {
  render: () => (
    <ServerProvidersStory
      openCodeInstalled
      detection={{ scanning: true, found: STORY_DETECTED_PROVIDERS.slice(0, 1) }}
    />
  ),
};

/** The scan is done and Ollama is already added, so its row offers Edit. Scan again runs it once more. */
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

/** The user hid LM Studio in an earlier run. Show hidden puts it back in the list. */
export const HiddenDetectedProviders: Story = {
  render: () => (
    <ServerProvidersStory
      openCodeInstalled
      detection={{ scanning: false, found: STORY_DETECTED_PROVIDERS }}
      hiddenDetected={["models:http://127.0.0.1:1234/v1"]}
    />
  ),
};

/**
 * Where the scan looks: a server on another computer and a folder that is not on the PATH. With the
 * switch off, the section shows no detected list.
 */
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

/** Nothing runs at the default addresses and no known agent is on the PATH. */
export const NothingDetected: Story = {
  render: () => <ServerProvidersStory openCodeInstalled detection={{ scanning: false, found: [] }} />,
};

/**
 * Two saved endpoints. The count on the Custom provider row opens the dialog that lists them, so the
 * Providers section keeps its rows of fixed height.
 */
export const CustomProviderList: Story = {
  render: () => <ServerProvidersStory openCodeInstalled customProviderList />,
};

/**
 * The ChatGPT row signed out. The sign-in finished on another device sits in the row's actions
 * menu, so the row still leads with one button.
 */
export const CodeSignIn: Story = {
  render: () => <ServerProvidersStory codeSignIn />,
};

/** A joined server with `codex-api-key-v1`: the signed-out Codex row offers API key next to Connect. */
export const HostCodexKey: Story = {
  render: () => <ServerProvidersStory hostCodexKey="missing" />,
};

/** The same server after the key: Codex on the host uses the OpenAI API key. */
export const HostCodexKeySaved: Story = {
  render: () => <ServerProvidersStory hostCodexKey="saved" />,
};

/**
 * A joined server whose host has `custom-provider-edit-v1`. Open the endpoint list: each endpoint
 * offers Edit. The form changes the name, address, models, key and headers; the host keeps the
 * harness and the model limits.
 */
export const HostCustomProviderEdit: Story = {
  render: () => <ServerProvidersStory openCodeInstalled hostCustomProviders="edit" />,
};

/** The same server on an older host: the endpoint list offers Remove only. */
export const HostCustomProviderRemoveOnly: Story = {
  render: () => <ServerProvidersStory openCodeInstalled hostCustomProviders="remove-only" />,
};

export const ProviderDownloads: Story = {
  render: () => <ServerProvidersStory providerDownloads />,
  parameters: { viewport: { defaultViewport: "serverPhone" } },
};

/** The durable surface: the update the toast offers is still here after the toast is gone. */
export const ProviderUpdateAvailable: Story = {
  render: () => <ServerProvidersStory providerUpdate />,
};

export const ProviderUpdateRetry: Story = {
  render: () => <ServerProvidersStory providerUpdate providerUpdateFailure />,
};

/**
 * Open ChatGPT: the page shows only the download. Press Download: the notification and the card show
 * the progress, and the other sections come when the download ends.
 */
export const ProviderFirstDownload: Story = {
  render: () => <ServerProvidersStory providerUpdate providerFirstDownload />,
};

/**
 * Cursor, Antigravity and Cline are installed for other work, so the user turned them off. Agents use
 * Codex and Claude, so those switches stay on. Open Cursor: its Danger zone offers Delete, and after
 * it the list reads "Off · Not downloaded".
 */
export const ProvidersOff: Story = {
  render: () => (
    <ServerProvidersStory
      providerUpdate
      offProviders={["cursor", "antigravity", "cline"]}
      providerUsers={{ codex: ["Ada"], claude: ["Rex", "Mila"] }}
    />
  ),
};

/**
 * Open Codex: the ⋯ menu of the own sign-in offers Reset usage, as Codex gave it two usage resets. The
 * Work account has none, so its menu does not. The confirmation names the credits left.
 */
export const CodexUsageReset: Story = {
  render: () => <ServerProvidersStory usageReset />,
};

/**
 * Open Codex: two accounts show the Pool accounts switch, off at first. On, agents use one account
 * until it nears a usage limit. The ⋯ menu of an account leaves it out of the pool or puts it back.
 */
export const AccountPool: Story = {
  render: () => <ServerProvidersStory accountPool />,
};

/** A host that sends no Hermes installer status, such as a Windows host: the row opens the install guide. */
export const HermesInstallGuide: Story = {
  render: () => <ServerProvidersStory hermes={null} />,
};

/** The host can run the Hermes installer: the row offers Download. */
export const HermesDownload: Story = {
  render: () => (
    <ServerProvidersStory hermes={{ phase: "not-downloaded", progress: null, message: null, version: null }} />
  ),
};

/** The installer runs one stage at a time, and each stage moves the bar. Cancel stops it. */
export const HermesInstalling: Story = {
  render: () => <ServerProvidersStory hermes={{ phase: "downloading", progress: 25, message: null, version: null }} />,
};

/** Hermes is installed: the row offers Connect, which signs in with the Nous Portal code. */
export const HermesConnect: Story = {
  render: () => <ServerProvidersStory hermes={{ phase: "ready", progress: 100, message: null, version: "0.22.7" }} />,
};

/** A server that the window has not selected. Its providers are managed after a switch to it. */
export const NotSelectedServer: Story = {
  render: () => <ServerProvidersStory inactive />,
};

function localStoryServer(): ServerSummary {
  const server = STORY_SERVERS.find((candidate) => candidate.kind === "local");
  if (!server) throw new Error("Story server fixtures need a local server.");
  return server;
}
