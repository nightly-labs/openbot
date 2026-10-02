import type {
  AgentStatus,
  CustomProviderRestart,
  CustomProviderSummary,
  ProviderRuntimeSnapshot,
  ServerSummary,
} from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import type { ProviderDetection } from "@openbot/ui/features/custom-providers/detected-providers";
import type { ProviderDetectionSettingsValue } from "@openbot/ui/features/custom-providers/ProviderDetectionSettings";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createProviderRuntimeStore } from "../src/features/provider-updates/provider-runtime-store";
import { ServerSettingsModal } from "../src/features/servers/ServerSettingsModal";
import { STORY_HOST_STATUS, STORY_INVITES, STORY_PRESENCE, STORY_SERVERS } from "../src/preview/fixtures";
import { createFakeCodeLogin } from "./code-login-fixture";
import { createStoryDetection, STORY_DETECTED_PROVIDERS } from "./detected-providers-fixture";
import { createMockOpenBot } from "./mock-openbot";

const localServer = localStoryServer();

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
  cursor: { phase: "ready", progress: 100, message: null, version: "2026.09.28-64d2043" },
  cline: { phase: "ready", progress: 100, message: null, version: "3.0.68" },
};

/** The Providers section of Server settings, with the providers of this computer. */
function ServerProvidersStory(props: {
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
  /** Where the scan looks. Without it the section has no detection settings. */
  detectionSettings?: ProviderDetectionSettingsValue;
  /** A server that the window has not selected: the section offers the switch. */
  inactive?: boolean;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({
    ...(props.providerUpdate
      ? {
          providerRuntimeSnapshot: {
            revision: 0,
            providers: providerUpdateRuntimeStatuses,
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
  const [open, setOpen] = createSignal(true);
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

  return (
    <>
      <ServerSettingsModal
        open={open()}
        onOpenChange={setOpen}
        platform="darwin"
        server={props.inactive ? { ...localServer, active: false } : localServer}
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
        onSwitchToManageProviders={props.inactive ? fn() : undefined}
        providers={
          props.inactive
            ? undefined
            : {
                get agentStatus() {
                  return props.codeSignIn
                    ? codeSignInAgentStatus
                    : props.providerUpdate
                      ? providerUpdateAgentStatus
                      : props.openCodeInstalled
                        ? openCodeInstalledAgentStatus
                        : providerAgentStatus;
                },
                codeLogin: props.codeSignIn ? codeLogin : undefined,
                get providerRuntimeStatuses() {
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
                  : props.providerDownloads
                    ? fn()
                    : undefined,
                onCancelProviderDownload: props.providerUpdate
                  ? runtimes.cancelProviderRuntimeDownload
                  : props.providerDownloads
                    ? fn()
                    : undefined,
                onConnectProvider:
                  props.providerDownloads || props.providerUpdate || props.codeSignIn ? fn() : undefined,
                onAddCustomProvider: addCustomProvider,
                onDeleteCustomProvider: deleteCustomProvider,
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
              }
        }
      />
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

/** A server that the window has not selected. Its providers are managed after a switch to it. */
export const NotSelectedServer: Story = {
  render: () => <ServerProvidersStory inactive />,
};

function localStoryServer(): ServerSummary {
  const server = STORY_SERVERS.find((candidate) => candidate.kind === "local");
  if (!server) throw new Error("Story server fixtures need a local server.");
  return server;
}
