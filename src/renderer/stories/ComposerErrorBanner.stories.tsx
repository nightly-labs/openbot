import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import { ComposerUsageLimitNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import type { JSX } from "@solidjs/web";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/Composer error banner",
  component: ComposerErrorBanner,
  args: {
    message: "The model endpoint refused the request.",
    onDismiss: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ComposerErrorBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The composer column, so the banner is judged at the width it actually renders at. */
function ComposerStack(props: { children: JSX.Element }) {
  return (
    <div class="composer-wrap" style={{ width: "640px", padding: "16px" }}>
      {props.children}
    </div>
  );
}

/** A fixed moment, so the story reads the same on every run and in every review screenshot. */
const USAGE_RESETS_AT = Date.UTC(2026, 8, 21, 9, 0) / 1_000;

export const ProviderError: Story = {
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

/**
 * A provider that retries a dropped transport reports the same failure once per attempt. Every
 * report used to become a bubble in the transcript; one banner now stands for the whole run,
 * whatever its length, and one press clears it.
 */
export const DroppedTransport: Story = {
  args: {
    message:
      "Falling back from WebSockets to HTTPS transport. stream disconnected before completion: Connection refused (os error 61)",
  },
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

/**
 * The provider names no cause. The transcript used to show the bare word "error"; the sentence the
 * renderer writes in its place at least tells the reader what to do next.
 */
export const UnnamedFailure: Story = {
  args: { message: "The agent could not continue. Try again." },
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

/** The 401 a lapsed account returns, named rather than quoted. */
export const AuthenticationFailed: Story = {
  args: { message: "Authentication failed. Check your account or server connection, then try again." },
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

/**
 * The two blocks the composer column can carry together, in the order the reader meets them: the
 * un-actionable state first, then the dismissible report of one failed turn.
 */
export const BesideTheUsageLimit: Story = {
  render: (args) => (
    <ComposerStack>
      <ComposerUsageLimitNotice provider="codex" resetsAt={USAGE_RESETS_AT} />
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};
