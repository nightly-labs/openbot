import { PendingSendStatus } from "@openbot/ui/features/conversation/PendingSendStatus";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/Pending send status",
  component: PendingSendStatus,
  args: {
    state: "sending",
    error: null,
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

export const Sending: Story = {};

/** A later message waits for the one before it, so the host keeps the order the user sent. */
export const Waiting: Story = { args: { state: "waiting" } };

export const Failed: Story = { args: { state: "failed", error: "The host is offline." } };

/** The composer holds other text, so Edit would replace it. */
export const FailedWithDraft: Story = { args: { state: "failed", canEdit: false } };

/** An older host cannot drop a repeated send, so there is no Retry: the first one may have arrived. */
export const Unconfirmed: Story = { args: { state: "failed", retrySafe: false } };

export const UpdateRequired: Story = { args: { state: "failed", updateRequired: true } };
