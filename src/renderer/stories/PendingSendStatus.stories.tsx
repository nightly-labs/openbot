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

/** The composer holds other text, so Edit would replace it. */
export const FailedWithDraft: Story = { args: { canEdit: false } };

/** An older host cannot drop a repeated send, so there is no Retry: the first one may have arrived. */
export const Unconfirmed: Story = { args: { retrySafe: false, error: null } };

/** The composer shows the update notice, so the row keeps only Edit and Dismiss. */
export const UpdateRequired: Story = { args: { updateRequired: true } };
