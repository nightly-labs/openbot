import type {
  AgentStatus,
  AvatarImageInput,
  CentralAuthUser,
  CustomProviderRestart,
  CustomProviderSummary,
  MobileConnectedDevice,
  ProviderRuntimeSnapshot,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { Button, Heading, Text, Toaster, toast } from "@openbot/ui";
import type { ProviderDetection } from "@openbot/ui/features/custom-providers/detected-providers";
import type { ProviderDetectionSettingsValue } from "@openbot/ui/features/custom-providers/ProviderDetectionSettings";
import { DEFAULT_GENERAL_SETTINGS } from "@openbot/ui/features/settings/app-settings";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createProviderRuntimeStore } from "../src/features/provider-updates/provider-runtime-store";
import { SettingsModal, type SettingsTab } from "../src/features/settings/SettingsModal";
import { createMockBilling } from "../src/preview/mock-billing";
import { createFakeCodeLogin } from "./code-login-fixture";
import { createStoryDetection, STORY_DETECTED_PROVIDERS } from "./detected-providers-fixture";
import { createMockOpenBot } from "./mock-openbot";

const storyAppInfo = { name: "OpenBot", version: "0.2.1", platform: "darwin", variant: "dev" } as const;
const storyAccount: CentralAuthUser = {
  id: "user-1",
  email: "person@example.com",
  name: "Norbert",
  avatarUrl: null,
};
const storyUpdateStatus: UpdateStatus = {
  phase: "idle",
  currentVersion: "0.2.1",
  availableVersion: null,
  progress: null,
  checkedAt: null,
  message: null,
  errorCode: null,
};
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
/** OpenCode installed with no account of its own: enough to run an endpoint that brings its own key. */
const openCodeInstalledAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: [
    ...(providerUpdateAgentStatus.providers ?? []),
    { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null },
  ],
};
/** ChatGPT installed and signed out, so its row offers both ways in. The rest are connected. */
const codeSignInAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: (providerUpdateAgentStatus.providers ?? []).map((provider) =>
    provider.id === "codex"
      ? { ...provider, state: "sign-in-required", version: "0.149.1", message: "Connect ChatGPT to continue." }
      : provider,
  ),
};
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
const providerUpdateRuntimeStatuses: ProviderRuntimeSnapshot["providers"] = {
  codex: { phase: "ready", progress: 100, message: null, version: "0.149.1" },
  claude: { phase: "ready", progress: 100, message: null, version: "2.1.246", availableVersion: "2.1.250" },
  grok: { phase: "ready", progress: 100, message: null, version: "1.0.5" },
  opencode: { phase: "ready", progress: 100, message: null, version: "1.18.30" },
  antigravity: { phase: "ready", progress: 100, message: null, version: "1.2.1" },
};

function SettingsModalStory(props: {
  initialOpen: boolean;
  providerDownloads?: boolean;
  providerUpdate?: boolean;
  providerUpdateFailure?: boolean;
  openCodeInstalled?: boolean;
  customProviderList?: boolean;
  codeSignIn?: boolean;
  /** The first result of a fake scan. Scan again runs the whole scan. */
  detection?: ProviderDetection;
  /** Detected IDs that the user hid in an earlier run. */
  hiddenDetected?: readonly string[];
  /** Where the scan looks. Without it the tab has no detection settings. */
  detectionSettings?: ProviderDetectionSettingsValue;
  /** Adds the Hosted servers tab with a stopped server and a server whose plan ended. */
  hostedServers?: boolean;
  initialTab?: SettingsTab;
  /** A restart that a server admin asked for. */
  scheduledRestart?: UpdateStatus["scheduledRestart"];
}) {
  const previousApi = window.openbot;
  const billingApi = createMockBilling();
  const mock = createMockOpenBot({
    providerRuntimeSnapshot: props.providerUpdate
      ? {
          revision: 0,
          providers: providerUpdateRuntimeStatuses,
          toolRuntimes: { bun: { phase: "ready", progress: 100, message: null, version: "1.4.2" } },
        }
      : undefined,
    providerRuntimeFailure: props.providerUpdateFailure,
  });
  const runtimes = createProviderRuntimeStore(() => (props.providerUpdate ? mock.api.providerRuntimes : undefined));
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    toast.dismiss();
    window.openbot = previousApi;
  });
  const [open, setOpen] = createSignal(props.initialOpen);
  const [value, setValue] = createSignal({ ...DEFAULT_GENERAL_SETTINGS });
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>(
    props.scheduledRestart
      ? { ...storyUpdateStatus, phase: "ready", availableVersion: "0.3.0", scheduledRestart: props.scheduledRestart }
      : storyUpdateStatus,
  );
  const [account, setAccount] = createSignal<CentralAuthUser>({ ...storyAccount });
  const [mobileDevices, setMobileDevices] = createSignal<MobileConnectedDevice[]>([
    {
      sessionId: "11111111-1111-4111-8111-111111111111",
      name: "Norbert’s iPhone",
      platform: "ios",
      connectedAt: Date.now() - 86_400_000,
      lastActiveAt: Date.now() - 45_000,
    },
  ]);
  const codeLogin = createFakeCodeLogin({ finishAfterMs: 0 });
  const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>(
    props.customProviderList ? [...STORY_CUSTOM_PROVIDERS] : [],
  );
  const [detectionSettings, setDetectionSettings] = createSignal(props.detectionSettings);
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

  async function updateAccountAvatar(image: AvatarImageInput | null): Promise<void> {
    const avatarUrl = image
      ? `data:${image.mimeType};base64,${btoa(Array.from(image.bytes, (byte) => String.fromCharCode(byte)).join(""))}`
      : null;
    setAccount((current) => ({ ...current, avatarUrl }));
  }

  async function updateAccountName(name: string): Promise<void> {
    setAccount((current) => ({ ...current, name }));
  }

  async function runUpdateAction(): Promise<void> {
    setUpdateStatus({ ...storyUpdateStatus, phase: "up-to-date", checkedAt: new Date().toISOString() });
  }

  async function createMobileConnect(): Promise<{ qrData: string; expiresAt: number }> {
    return {
      qrData:
        "openbot://mobile-connect?api=https%3A%2F%2Fapi.openbot.run&ticket=storybook-mobile-ticket_1234567890abcdef",
      expiresAt: Date.now() + 120_000,
    };
  }

  return (
    <>
      <main class="foundation-story foundation-interaction-stage">
        <Heading as="h1" size="lg">
          Workspace settings
        </Heading>
        <Text tone="secondary">Preview the global settings surface with session-scoped preferences.</Text>
        <Button variant="outline" type="button" onClick={() => setOpen(true)}>
          Open settings
        </Button>
        <SettingsModal
          initialTab={props.initialTab}
          open={open()}
          onOpenChange={setOpen}
          value={value()}
          onValueChange={setValue}
          appInfo={storyAppInfo}
          updateStatus={updateStatus()}
          onCancelScheduledRestart={async () => {
            const { scheduledRestart: _cancelled, ...rest } = updateStatus();
            setUpdateStatus(rest);
          }}
          account={account()}
          onUpdateAccountName={updateAccountName}
          onUpdateAccountAvatar={updateAccountAvatar}
          onCreateMobileConnect={createMobileConnect}
          onListMobileConnectedDevices={async () => mobileDevices()}
          onListAccountSessions={mock.api.auth.listAccountSessions}
          onRevokeAccountSession={mock.api.auth.revokeAccountSession}
          onRevokeMobileConnectedDevice={async (sessionId) => {
            setMobileDevices((current) => current.filter((device) => device.sessionId !== sessionId));
          }}
          onUpdateAction={runUpdateAction}
          billingApi={billingApi}
          agentStatus={
            props.codeSignIn
              ? codeSignInAgentStatus
              : props.providerUpdate
                ? providerUpdateAgentStatus
                : props.providerDownloads
                  ? providerAgentStatus
                  : props.openCodeInstalled
                    ? openCodeInstalledAgentStatus
                    : undefined
          }
          codeLogin={props.codeSignIn ? codeLogin : undefined}
          providerRuntimeStatuses={
            props.providerUpdate
              ? runtimes.providerRuntimeStatuses()
              : props.providerDownloads
                ? providerRuntimeStatuses
                : undefined
          }
          providerAvailableVersions={props.providerUpdate ? runtimes.providerAvailableVersions() : undefined}
          onUpdateProvider={props.providerUpdate ? runtimes.downloadProviderRuntime : undefined}
          onDownloadProvider={
            props.providerUpdate ? runtimes.downloadProviderRuntime : props.providerDownloads ? fn() : undefined
          }
          onCancelProviderDownload={
            props.providerUpdate ? runtimes.cancelProviderRuntimeDownload : props.providerDownloads ? fn() : undefined
          }
          onConnectProvider={props.providerDownloads || props.providerUpdate || props.codeSignIn ? fn() : undefined}
          onAddCustomProvider={addCustomProvider}
          onDeleteCustomProvider={deleteCustomProvider}
          customProviders={customProviders()}
          providerDetection={detection?.detection()}
          detectedProviderApi={detection?.api}
          detectionSettings={detectionSettings()}
          onDetectionSettingsChange={setDetectionSettings}
          hostedServersApi={props.hostedServers ? mock.api.hostedServers : undefined}
          onAddHostedServer={props.hostedServers ? fn() : undefined}
        />
      </main>
      <Toaster />
    </>
  );
}

const meta = {
  title: "Settings/SettingsModal",
  component: SettingsModal,
  args: {
    open: false,
    onOpenChange: fn(),
    value: DEFAULT_GENERAL_SETTINGS,
    onValueChange: fn(),
    appInfo: storyAppInfo,
    updateStatus: storyUpdateStatus,
    onUpdateAction: fn(async () => undefined),
    account: storyAccount,
    onUpdateAccountName: fn(async () => undefined),
    onUpdateAccountAvatar: fn(async () => undefined),
    onCreateMobileConnect: fn(async () => ({
      qrData:
        "openbot://mobile-connect?api=https%3A%2F%2Fapi.openbot.run&ticket=storybook-mobile-ticket_1234567890abcdef",
      expiresAt: Date.now() + 120_000,
    })),
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        settingsDesktop: {
          name: "Settings — 1200 × 820",
          styles: { width: "1200px", height: "820px" },
        },
        settingsNarrow: {
          name: "Settings — 640 × 720",
          styles: { width: "640px", height: "720px" },
        },
        settingsPhone: {
          name: "Settings — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
} satisfies Meta<typeof SettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: () => <SettingsModalStory initialOpen />,
};

/** The row that adds a self-described endpoint. OpenCode is installed, so the row offers Add. */
export const AddCustomProvider: Story = {
  render: () => <SettingsModalStory initialOpen openCodeInstalled initialTab="providers" />,
};

/** The AI providers tab looks for local model servers and ACP agents each time it opens. */
export const DetectingProviders: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      openCodeInstalled
      initialTab="providers"
      detection={{ scanning: true, found: STORY_DETECTED_PROVIDERS.slice(0, 1) }}
    />
  ),
};

/** The scan is done and Ollama is already added, so its row offers Edit. Scan again runs it once more. */
export const DetectedProviders: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      openCodeInstalled
      initialTab="providers"
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
    <SettingsModalStory
      initialOpen
      openCodeInstalled
      initialTab="providers"
      detection={{ scanning: false, found: STORY_DETECTED_PROVIDERS }}
      hiddenDetected={["models:http://127.0.0.1:1234/v1"]}
    />
  ),
};

/**
 * Where the scan looks: a server on another computer and a folder that is not on the PATH. With the
 * switch off, the tab shows no detected list.
 */
export const DetectionSettings: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      openCodeInstalled
      initialTab="providers"
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
  render: () => (
    <SettingsModalStory
      initialOpen
      openCodeInstalled
      initialTab="providers"
      detection={{ scanning: false, found: [] }}
    />
  ),
};

/**
 * Two saved endpoints. The count on the Custom provider row opens the dialog that lists them, so the
 * AI providers section keeps its rows of fixed height.
 */
export const CustomProviderList: Story = {
  render: () => <SettingsModalStory initialOpen openCodeInstalled customProviderList initialTab="providers" />,
};

/**
 * The ChatGPT row signed out. The sign-in finished on another device sits in the row's actions
 * menu, so the row still leads with one button.
 */
export const CodeSignIn: Story = {
  render: () => <SettingsModalStory initialOpen codeSignIn initialTab="providers" />,
};

export const Narrow: Story = {
  render: () => <SettingsModalStory initialOpen />,
  parameters: { viewport: { defaultViewport: "settingsNarrow" } },
};

export const ProviderDownloads: Story = {
  render: () => <SettingsModalStory initialOpen providerDownloads initialTab="providers" />,
  parameters: { viewport: { defaultViewport: "settingsPhone" } },
};

/** The durable surface: the update the toast offers is still here after the toast is gone. */
export const ProviderUpdateAvailable: Story = {
  render: () => <SettingsModalStory initialOpen providerUpdate initialTab="providers" />,
};

export const ProviderUpdateRetry: Story = {
  render: () => <SettingsModalStory initialOpen providerUpdate providerUpdateFailure initialTab="providers" />,
};

/** No plan yet. Choose a plan: the mock then shows it as active, as after a Stripe payment. */
export const Billing: Story = {
  render: () => <SettingsModalStory initialOpen initialTab="billing" />,
};

/** An account that can create hosted servers. Start, renew and delete change the mock list. */
export const HostedServers: Story = {
  render: () => <SettingsModalStory initialOpen hostedServers initialTab="hosted-servers" />,
};

export const ScheduledRemoteUpdate: Story = {
  render: () => (
    <SettingsModalStory
      initialOpen
      initialTab="updates"
      scheduledRestart={{ requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: ["agent-turn"] }}
    />
  ),
};

export const Interactive: Story = {
  render: () => <SettingsModalStory initialOpen={false} />,
};
