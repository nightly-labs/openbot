import { PendingSendStatus } from "@openbot/ui/features/conversation/PendingSendStatus";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/Pending send status",
  component: PendingSendStatus,
  args: {
    state: "failed",
    error: "The host is offline.",
    retrySafe: true,
    canEdit: true,
    onRetry: fn(),
    onEdit: fn(),
    onDismiss: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof PendingSendStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Failed: Story = {};

export const FailedWithDraft: Story = { args: { canEdit: false } };

export const Unconfirmed: Story = { args: { retrySafe: false, error: null } };

export const UpdateRequired: Story = { args: { updateRequired: true } };

export const WaitingForFailed: Story = { args: { state: "waiting", error: null, heldByFailed: true } };
