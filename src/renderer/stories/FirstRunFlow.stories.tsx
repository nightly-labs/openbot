import type { AgentProviderId, AppSetupState } from "@openbot/contracts/ipc";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FirstRunFlow, type FirstRunFlowProps } from "../src/features/onboarding/FirstRunFlow";
import { FakeProviderDownloads, lazyProviderAgentStatus, MockedOnboardingApi } from "./onboarding-fixture";

const setupState: AppSetupState = { completed: false, preferredProvider: null, preferredModel: null };

/**
 * A new computer: nothing is downloaded. OpenCode downloads when first run opens, and "Start free"
 * starts it while the user reads the next step. A plan provider downloads and then opens its
 * sign-in. The computer step asks for both permissions.
 */
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

/** One question: start free now, or connect a plan. */
export const Choice: Story = {};

export const ChoiceNarrow: Story = {
  globals: { viewport: "onboardingNarrow" },
};

/**
 * Not macOS, so there is no computer step. "Start free" waits on the first screen until OpenCode
 * is ready, then opens the app.
 */
export const ChoiceWithoutComputerStep: Story = {
  args: { platform: "linux" },
};

/**
 * "Use your … plan": ChatGPT, Claude and Grok are downloaded, so the plan step only connects.
 * OpenCode is not in the list; "Start free instead" leaves the plan step.
 */
export const SubscriptionPath: Story = {
  render: (storyArgs) => <NewComputerFirstRun args={storyArgs} downloaded />,
};

/**
 * OpenCode downloads slowly. Press "Start free", then "Open OpenBot" at once: the button waits,
 * says why, and opens the app when OpenCode is ready.
 */
export const FreeStillDownloading: Story = {
  render: (storyArgs) => <NewComputerFirstRun args={storyArgs} tickMs={600} />,
};

/** Setup cannot be saved, so the last step shows the error and keeps the button. */
export const FinishFails: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error("The settings file is read-only.");
    }),
  },
};
