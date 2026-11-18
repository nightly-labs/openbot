import type { UpdateStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { UpdateRequiredScreen } from "@openbot/ui/features/updates/UpdateRequiredScreen";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const BELOW_MINIMUM: UpdateStatus = {
  phase: "downloading",
  currentVersion: "0.40.2",
  availableVersion: "0.71.0",
  progress: 42,
  checkedAt: "2026-11-17T09:00:00.000Z",
  message: null,
  errorCode: null,
  requiredVersion: "0.58.0",
};

const meta = {
  title: "Updates/UpdateRequiredScreen",
  component: UpdateRequiredScreen,
  args: {
    status: BELOW_MINIMUM,
    logoVariant: "production",
    onUpdate: fn(async () => undefined),
    onOpenDownloadPage: fn(),
    onDismiss: fn(),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof UpdateRequiredScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The update downloads by itself. */
export const Downloading: Story = {};

export const Checking: Story = {
  args: { status: { ...BELOW_MINIMUM, phase: "checking", availableVersion: null, progress: null } },
};

/** Downloaded: it installs when the agents are idle, or now with the button. */
export const WaitingForAgents: Story = {
  args: {
    status: {
      ...BELOW_MINIMUM,
      phase: "ready",
      progress: null,
      scheduledRestart: { requestedBy: null, mode: "when-idle", waitingFor: ["agent-turn"] },
    },
  },
};

export const Failed: Story = {
  args: {
    status: {
      ...BELOW_MINIMUM,
      phase: "error",
      progress: null,
      message: sourceText("error.update.downloadStalled"),
      errorCode: "download_failed",
    },
  },
};

/** An install that cannot update itself, such as a Linux package or Nix: it can continue until the next start. */
export const Unsupported: Story = {
  args: { status: { ...BELOW_MINIMUM, phase: "unsupported", availableVersion: null, progress: null } },
};
