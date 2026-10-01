import type { AvatarImageInput, CentralAuthUser, MobileConnectedDevice, UpdateStatus } from "@openbot/contracts/ipc";
import { Button, Heading, Text, Toaster, toast } from "@openbot/ui";
import { DEFAULT_GENERAL_SETTINGS } from "@openbot/ui/features/settings/app-settings";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettingsModal } from "../src/features/settings/SettingsModal";
import type { SettingsTab } from "../src/features/settings/settings-tabs";
import { createMockBilling } from "../src/preview/mock-billing";
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

function SettingsModalStory(props: {
  initialOpen: boolean;
  /** Adds the Hosted servers tab with a stopped server and a server whose plan ended. */
  hostedServers?: boolean;
  initialTab?: SettingsTab;
  /** A restart that a server admin asked for. */
  scheduledRestart?: UpdateStatus["scheduledRestart"];
}) {
  const previousApi = window.openbot;
  const billingApi = createMockBilling();
  const mock = createMockOpenBot();
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

export const Narrow: Story = {
  render: () => <SettingsModalStory initialOpen />,
  parameters: { viewport: { defaultViewport: "settingsNarrow" } },
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
