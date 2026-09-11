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
import { createSignal, onCleanup } from "solid-js";
import { expect, fn, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button, Heading, Text, Toaster, toast } from "../src/components/ui";
import { createProviderRuntimeStore } from "../src/features/provider-updates/provider-runtime-store";
import { DEFAULT_GENERAL_SETTINGS } from "../src/features/settings/app-settings";
import { SettingsModal } from "../src/features/settings/SettingsModal";
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
const availableUpdateStatus: UpdateStatus = {
  ...storyUpdateStatus,
  phase: "available",
  availableVersion: "0.3.0",
};
const readyUpdateStatus: UpdateStatus = {
  ...availableUpdateStatus,
  phase: "ready",
  progress: 100,
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
};

function SettingsModalStory(props: {
  initialOpen: boolean;
  initialUpdateStatus?: UpdateStatus;
  mockDownloadUpdate?: boolean;
  providerDownloads?: boolean;
  providerUpdate?: boolean;
  providerUpdateFailure?: boolean;
  simulateMobileConnection?: boolean;
  openCodeInstalled?: boolean;
  customProviderList?: boolean;
  customProviderSaveFails?: boolean;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({
    providerRuntimeSnapshot: props.providerUpdate
      ? { revision: 0, providers: providerUpdateRuntimeStatuses }
      : undefined,
    providerRuntimeFailure: props.providerUpdateFailure,
  });
  const runtimes = createProviderRuntimeStore(props.providerUpdate ? mock.api.providerRuntimes : undefined);
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    toast.dismiss();
    window.openbot = previousApi;
  });
  const [open, setOpen] = createSignal(props.initialOpen);
  const [value, setValue] = createSignal({ ...DEFAULT_GENERAL_SETTINGS });
  const [updateStatus, setUpdateStatus] = createSignal<UpdateStatus>(props.initialUpdateStatus ?? storyUpdateStatus);
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
  let mobileConnectionTimer: number | undefined;

  onCleanup(() => {
    if (mobileConnectionTimer !== undefined) window.clearTimeout(mobileConnectionTimer);
  });

  const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>(
    props.customProviderList ? [...STORY_CUSTOM_PROVIDERS] : [],
  );

  async function addCustomProvider(): Promise<CustomProviderRestart> {
    if (props.customProviderSaveFails) throw new Error("House Router refused the API key.");
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
    if (!props.mockDownloadUpdate || updateStatus().phase !== "available") {
      setUpdateStatus({ ...storyUpdateStatus, phase: "up-to-date", checkedAt: new Date().toISOString() });
      return;
    }

    const downloadingStatus = { ...updateStatus(), phase: "downloading", progress: 0 } as const;
    setUpdateStatus(downloadingStatus);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setUpdateStatus({ ...downloadingStatus, progress: 48 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    setUpdateStatus({ ...downloadingStatus, phase: "ready", progress: 100 });
  }

  async function createMobileConnect(): Promise<{ qrData: string; expiresAt: number }> {
    if (props.simulateMobileConnection) {
      mobileConnectionTimer = window.setTimeout(() => {
        setMobileDevices((current) => [
          ...current,
          {
            sessionId: "22222222-2222-4222-8222-222222222222",
            name: "OpenBot iPhone",
            platform: "ios",
            connectedAt: Date.now(),
            lastActiveAt: Date.now(),
          },
        ]);
      }, 500);
    }
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
          open={open()}
          onOpenChange={setOpen}
          value={value()}
          onValueChange={setValue}
          appInfo={storyAppInfo}
          updateStatus={updateStatus()}
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
          agentStatus={
            props.providerUpdate
              ? providerUpdateAgentStatus
              : props.providerDownloads
                ? providerAgentStatus
                : props.openCodeInstalled
                  ? openCodeInstalledAgentStatus
                  : undefined
          }
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
          onConnectProvider={props.providerDownloads || props.providerUpdate ? fn() : undefined}
          onAddCustomProvider={addCustomProvider}
          onDeleteCustomProvider={deleteCustomProvider}
          customProviders={customProviders()}
          onAddCustomMcp={async () => undefined}
          onDeleteCustomMcp={async () => undefined}
          customMcpServers={[]}
          mcpFullAccess={false}
          onSetMcpFullAccess={async () => undefined}
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
  render: () => <SettingsModalStory initialOpen openCodeInstalled />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Add custom provider" }));
    await expect(body.findByRole("heading", { name: "Custom provider" })).resolves.toBeTruthy();
  },
};

/**
 * The saved endpoints, and the removal that discards a key. They are listed in a dialog the count on
 * the Custom provider row opens, so the AI providers section keeps its rows of fixed height.
 */
export const CustomProviderList: Story = {
  render: () => <SettingsModalStory initialOpen openCodeInstalled customProviderList />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Manage 2 endpoints" }));
    await expect(body.findByRole("button", { name: "Delete Studio Local" })).resolves.toBeTruthy();
    // The removal asks first. Storybook has no dialog to answer, so the answer is given here.
    const previousConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await userEvent.click(body.getByRole("button", { name: "Delete House Router" }));
      await waitFor(() => expect(body.queryByRole("button", { name: "Delete House Router" })).toBeNull());
      await expect(body.getByRole("button", { name: "Delete Studio Local" })).toBeVisible();
      // The last endpoint leaves the dialog on its empty state rather than closing under the hand.
      await userEvent.click(body.getByRole("button", { name: "Delete Studio Local" }));
      await expect(body.findByText("No custom endpoints yet.")).resolves.toBeTruthy();
    } finally {
      window.confirm = previousConfirm;
    }
  },
};

/** The endpoint is refused, so the form stays with the values, including the key the user typed. */
export const CustomProviderSaveFails: Story = {
  render: () => <SettingsModalStory initialOpen openCodeInstalled customProviderSaveFails />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Add custom provider" }));
    // A required field appends an aria-hidden asterisk to its label, so its name is not an exact match.
    await userEvent.type(await body.findByLabelText(/^Provider ID/), "house-router");
    await userEvent.type(body.getByLabelText(/^Display name/), "House Router");
    await userEvent.type(body.getByLabelText(/^Base URL/), "https://models.example.com/v1");
    await userEvent.type(body.getByLabelText("Model 1 ID"), "glm-5-air");
    await userEvent.type(body.getByLabelText("Model 1 display name"), "GLM 5 Air");
    await userEvent.click(body.getByRole("button", { name: "Submit" }));

    await expect(body.findByText("House Router refused the API key.")).resolves.toBeTruthy();
    await expect(body.getByLabelText(/^Provider ID/)).toHaveValue("house-router");
  },
};

export const Narrow: Story = {
  render: () => <SettingsModalStory initialOpen />,
  parameters: { viewport: { defaultViewport: "settingsNarrow" } },
};

export const ProviderDownloads: Story = {
  render: () => <SettingsModalStory initialOpen providerDownloads />,
  parameters: { viewport: { defaultViewport: "settingsPhone" } },
};

/** The durable surface: the update the toast offers is still here after the toast is gone. */
export const ProviderUpdateAvailable: Story = {
  render: () => <SettingsModalStory initialOpen providerUpdate />,
  play: async () => {
    const body = within(document.body);
    await expect(body.findByRole("button", { name: "Update Claude to 2.1.250" })).resolves.toBeEnabled();
  },
};

export const ProviderUpdateFromSettings: Story = {
  render: () => <SettingsModalStory initialOpen providerUpdate />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Update Claude to 2.1.250" }));
    await expect(body.findByText("Updating Claude")).resolves.toBeInTheDocument();
    await expect(body.findByText("Claude is up to date", undefined, { timeout: 8_000 })).resolves.toBeInTheDocument();
  },
};

export const ProviderUpdateRetry: Story = {
  render: () => <SettingsModalStory initialOpen providerUpdate providerUpdateFailure />,
};

export const Profile: Story = {
  render: () => <SettingsModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Profile" }));
  },
};

export const ComputerUse: Story = {
  render: () => <SettingsModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Computer Use" }));
  },
};

export const Updates: Story = {
  render: () => <SettingsModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Updates" }));
  },
};

export const MobileConnect: Story = {
  render: () => <SettingsModalStory initialOpen />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Mobile Connect" }));
    await userEvent.click(await body.findByRole("button", { name: "Generate QR code" }));
    await expect(await body.findByRole("img", { name: "Mobile Connect sign-in QR code" })).toBeVisible();
  },
};

export const MobileConnectSuccess: Story = {
  render: () => <SettingsModalStory initialOpen simulateMobileConnection />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Mobile Connect" }));
    await userEvent.click(await body.findByRole("button", { name: "Generate QR code" }));
    await expect(await body.findByText("Phone connected", undefined, { timeout: 3_000 })).toBeVisible();
  },
};

export const UpdateAvailable: Story = {
  render: () => <SettingsModalStory initialOpen initialUpdateStatus={availableUpdateStatus} />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Updates" }));
  },
};

export const DownloadUpdateFlow: Story = {
  render: () => <SettingsModalStory initialOpen initialUpdateStatus={availableUpdateStatus} mockDownloadUpdate />,
  play: async ({ step, userEvent }) => {
    const body = within(document.body);

    await step("Open the available OpenBot update", async () => {
      await userEvent.click(await body.findByRole("tab", { name: "Updates" }));
      await expect(body.getByText("OpenBot v0.3.0 is available to download.")).toBeVisible();
    });

    await step("Start the mocked download", async () => {
      const downloadButton = body.getByRole("button", { name: "Download update" });
      await expect(downloadButton).toBeEnabled();
      await userEvent.click(downloadButton);
      await expect(await body.findByText("Downloading OpenBot v0.3.0 · 0%")).toBeVisible();
      await expect(body.getByRole("button", { name: "Downloading update…" })).toBeDisabled();
    });

    await step("Finish the mocked download", async () => {
      await waitFor(() => expect(body.getByText("Downloading OpenBot v0.3.0 · 48%")).toBeVisible());
      await waitFor(() => expect(body.getByText("OpenBot v0.3.0 is ready. Restart to apply.")).toBeVisible());
      await expect(body.getByRole("button", { name: "Restart to update" })).toBeEnabled();
    });
  },
};

export const ReadyToInstall: Story = {
  render: () => <SettingsModalStory initialOpen initialUpdateStatus={readyUpdateStatus} />,
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("tab", { name: "Updates" }));
  },
};

export const Interactive: Story = {
  render: () => <SettingsModalStory initialOpen={false} />,
  play: async ({ canvas, userEvent }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole("button", { name: "Open settings" });

    await userEvent.click(trigger);
    let dialog = await body.findByRole("dialog", { name: "General" });
    await waitFor(() => expect(dialog).toBeVisible());
    await expect(body.getByTestId("settings-modal-scroll-frame")).toHaveAttribute("data-scroll-down");

    const generalTab = body.getByRole("tab", { name: "General" });
    generalTab.focus();
    await userEvent.keyboard("{ArrowDown}");
    const computerUseTab = body.getByRole("tab", { name: "Computer Use" });
    await expect(computerUseTab).toHaveAttribute("aria-selected", "true");
    await expect(body.getByRole("heading", { name: "Computer Use", level: 2 })).toBeVisible();

    await userEvent.keyboard("{ArrowDown}");
    const profileTab = body.getByRole("tab", { name: "Profile" });
    await expect(profileTab).toHaveAttribute("aria-selected", "true");
    await expect(body.getByRole("heading", { name: "Profile", level: 2 })).toBeVisible();
    await expect(body.getByRole("textbox", { name: "Display name" })).toHaveValue("Norbert");

    await userEvent.keyboard("{ArrowDown}");
    const updatesTab = body.getByRole("tab", { name: "Updates" });
    await expect(updatesTab).toHaveAttribute("aria-selected", "true");
    await expect(body.getByRole("heading", { name: "Updates", level: 2 })).toBeVisible();

    await userEvent.click(generalTab);
    await expect(generalTab).toHaveAttribute("aria-selected", "true");

    const linkTarget = body.getByRole("button", { name: /^Open external links in/ });
    await userEvent.click(linkTarget);
    await waitFor(() => expect(body.getByRole("listbox")).toBeVisible());
    await userEvent.click(body.getByRole("option", { name: "OpenBot" }));
    await expect(linkTarget).toHaveTextContent("OpenBot");

    const launchSwitch = body.getByRole("switch", { name: "Launch OpenBot at login" });
    await expect(launchSwitch).toBeChecked();
    await userEvent.click(launchSwitch);
    await expect(launchSwitch).not.toBeChecked();

    await userEvent.click(updatesTab);
    await userEvent.click(body.getByRole("button", { name: "Check for updates" }));
    await expect(body.getByText("OpenBot is up to date on the Stable track.")).toBeVisible();

    await userEvent.click(generalTab);

    await userEvent.click(body.getByRole("button", { name: "Close settings" }));
    await expect(dialog).toHaveAttribute("data-motion", "closing");
    await waitFor(() => expect(body.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    await userEvent.click(trigger);
    dialog = await body.findByRole("dialog", { name: "General" });
    await expect(body.getByRole("switch", { name: "Launch OpenBot at login" })).not.toBeChecked();
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toHaveAttribute("data-motion", "closing");
    await waitFor(() => expect(body.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    await userEvent.click(trigger);
    await body.findByRole("dialog", { name: "General" });
    await userEvent.click(body.getByTestId("settings-modal-backdrop"));
    await waitFor(() => expect(body.queryByRole("dialog", { name: "General" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
