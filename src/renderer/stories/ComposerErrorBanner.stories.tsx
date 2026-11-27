import { Button } from "@openbot/ui";
import { ComposerErrorBanner } from "@openbot/ui/features/conversation/ComposerErrorBanner";
import { ComposerUsageLimitNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
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

function ComposerStack(props: { children: JSX.Element }) {
  return (
    <div class="composer-wrap" style={{ width: "640px", padding: "16px" }}>
      {props.children}
    </div>
  );
}

const USAGE_RESETS_AT = Date.UTC(2026, 8, 21, 9, 0) / 1_000;

export const ProviderError: Story = {
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

export const DroppedTransport: Story = {
  args: {
    message: "stream disconnected before completion: Connection refused (os error 61)",
  },
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

export const UnnamedFailure: Story = {
  args: { message: "The agent could not continue. Try again." },
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

export const AuthenticationFailed: Story = {
  args: { message: "Authentication failed. Check your account or server connection, then try again." },
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner {...args} />
    </ComposerStack>
  ),
};

export const GeminiVerificationRequired: Story = {
  args: {
    message:
      "Google must verify your account before Gemini can answer. Verify your Google account in a browser, then send your message again.",
    title: "Gemini · Gemini 3 Flash",
  },
  render: (args) => (
    <ComposerStack>
      <ComposerErrorBanner
        {...args}
        action={
          <Button variant="outline" size="sm" type="button">
            Verify account
          </Button>
        }
      />
    </ComposerStack>
  ),
};

export const BesideTheUsageLimit: Story = {
  render: (args) => {
    const [dismissed, setDismissed] = createSignal(false);
    return (
      <ComposerStack>
        <Show when={!dismissed()}>
          <ComposerUsageLimitNotice provider="codex" resetsAt={USAGE_RESETS_AT} onDismiss={() => setDismissed(true)} />
        </Show>
        <ComposerErrorBanner {...args} />
      </ComposerStack>
    );
  },
};
