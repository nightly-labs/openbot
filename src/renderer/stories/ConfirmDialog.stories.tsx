import { Button, ConfirmDialog, type ConfirmDialogProps, Heading, UserAvatar } from "@openbot/ui";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

type DemoProps = Omit<ConfirmDialogProps, "open" | "onCancel"> & {
  triggerLabel: string;
  initiallyOpen?: boolean;
  onCancel?: () => void;
};

/** Owns the open state the way a caller does: the trigger opens, cancel and a finished confirm close. */
function ConfirmDialogDemo(props: DemoProps) {
  const [open, setOpen] = createSignal(props.initiallyOpen ?? false);
  return (
    <main class="foundation-story foundation-interaction-stage">
      <Heading as="h1" size="lg">
        Confirmation dialog
      </Heading>
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>
        {props.triggerLabel}
      </Button>
      <ConfirmDialog
        {...props}
        open={open()}
        onCancel={() => {
          props.onCancel?.();
          setOpen(false);
        }}
        onConfirm={async () => {
          await props.onConfirm();
          setOpen(false);
        }}
      />
    </main>
  );
}

const meta = {
  title: "Foundations/ConfirmDialog",
  component: ConfirmDialogDemo,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: {
    triggerLabel: "Delete folder",
    initiallyOpen: true,
    title: "Delete Research?",
    description: "The agents in this folder move to the top of the sidebar. Their conversations are kept.",
    confirmLabel: "Delete",
    pendingLabel: "Deleting…",
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConfirmDialogDemo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Destructive: Story = {};

export const WithAvatar: Story = {
  args: {
    triggerLabel: "Delete agent",
    title: "Delete Nova?",
    description:
      "This removes the agent and its OpenBot conversation from the app. Its queue, memories, routines, and workspace are deleted.",
    media: <UserAvatar user={{ name: "Nova", email: "nova@example.com", avatarUrl: null }} decorative />,
  },
};

export const Neutral: Story = {
  args: {
    triggerLabel: "Always allow",
    tone: "default",
    title: "Always allow Nova?",
    description:
      "Nova can run commands and edit files in its workspace without asking first. You can change this later.",
    confirmLabel: "Always allow",
    pendingLabel: undefined,
    initialFocus: "cancel",
  },
};

export const Pending: Story = {
  args: { pending: true },
};

export const WithError: Story = {
  args: { error: "Could not delete Research. Try again." },
};

export const WithDetails: Story = {
  args: {
    triggerLabel: "Uninstall plugin",
    title: "Uninstall Linear?",
    description: "OpenBot removes these items from this computer:",
    confirmLabel: "Uninstall",
    pendingLabel: "Uninstalling…",
    children: (
      <ul>
        <li>3 skills</li>
        <li>1 MCP server</li>
        <li>Saved plugin settings</li>
      </ul>
    ),
  },
};

export const KeyboardFlow: Story = {
  args: { initiallyOpen: false },
};
