import type { AgentProviderId, AppSetupState } from "@openbot/contracts/ipc";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FirstRunFlow, type FirstRunFlowProps } from "../src/features/onboarding/FirstRunFlow";
import { FakeProviderDownloads, lazyProviderAgentStatus, MockedOnboardingApi } from "./onboarding-fixture";

const setupState: AppSetupState = { completed: false, preferredProvider: null, preferredModel: null };

function NewComputerFirstRun(props: { args: FirstRunFlowProps; downloaded?: boolean; tickMs?: number }) {
  return (
    <FakeProviderDownloads
      downloaded={props.downloaded}
      tickMs={props.tickMs}
      render={(fake) => (
        <MockedOnboardingApi permissions>
          <FirstRunFlow {...props.args} {...fake} />
        </MockedOnboardingApi>
      )}
    />
  );
}

const args: FirstRunFlowProps = {
  state: setupState,
  agentStatus: lazyProviderAgentStatus,
  platform: "darwin",
  onSave: fn(async (_provider: AgentProviderId) => undefined),
  onAnalyticsChoice: fn(),
  onAddCustomProvider: fn(async () => "restarted" as const),
  customProviders: [],
};

const meta = {
  title: "Setup/FirstRunFlow",
  component: FirstRunFlow,
  args,
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        onboardingNarrow: {
          name: "Onboarding — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
  render: (storyArgs) => <NewComputerFirstRun args={storyArgs} />,
} satisfies Meta<typeof FirstRunFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Choice: Story = {};

export const ChoiceNarrow: Story = {
  globals: { viewport: "onboardingNarrow" },
};

export const ChoiceWithoutComputerStep: Story = {
  args: { platform: "linux" },
};

export const SubscriptionPath: Story = {
  render: (storyArgs) => <NewComputerFirstRun args={storyArgs} downloaded />,
};

export const FreeStillDownloading: Story = {
  render: (storyArgs) => <NewComputerFirstRun args={storyArgs} tickMs={600} />,
};

export const FinishFails: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error("The settings file is read-only.");
    }),
  },
};

const ACCOUNT_SERVERS: NonNullable<FirstRunFlowProps["existingServers"]> = [
  { id: "host-7f3a91c2", name: "MacBook-Pro", state: "online", logoUrl: null },
  { id: "host-0b6d44e8", name: "MacBook-Air", state: "offline", logoUrl: null },
  { id: "host-52c9e0aa", name: "Research server on a Hetzner VPS in Falkenstein", state: "connecting", logoUrl: null },
];

export const ExistingServers: Story = {
  args: {
    existingServers: ACCOUNT_SERVERS,
    onOpenServer: fn(async () => new Promise<boolean>(() => undefined)),
  },
};

export const ExistingServerOpenFails: Story = {
  args: {
    existingServers: ACCOUNT_SERVERS,
    onOpenServer: fn(async () => {
      throw new Error("The server did not answer.");
    }),
  },
};
