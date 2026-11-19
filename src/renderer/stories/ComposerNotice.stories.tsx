import {
  ComposerSignInNotice,
  ComposerUpdateNotice,
  ComposerUsageLimitNotice,
} from "@openbot/ui/features/conversation/ComposerNotice";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/Composer notice",
  component: ComposerSignInNotice,
  args: {
    provider: "codex",
    onSignIn: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ComposerSignInNotice>;

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

export const SignInRequired: Story = {
  render: (args) => (
    <ComposerStack>
      <ComposerSignInNotice {...args} />
    </ComposerStack>
  ),
};

export const ClaudeSignInRequired: Story = {
  args: { provider: "claude" },
  render: (args) => (
    <ComposerStack>
      <ComposerSignInNotice {...args} />
    </ComposerStack>
  ),
};

export const SigningIn: Story = {
  args: { signingIn: true },
  render: (args) => (
    <ComposerStack>
      <ComposerSignInNotice {...args} />
    </ComposerStack>
  ),
};

export const SigningInWithCodeFallback: Story = {
  args: { onSignInWithCode: fn() },
  render: (args) => {
    const [signingIn, setSigningIn] = createSignal(false);
    return (
      <ComposerStack>
        <ComposerSignInNotice {...args} signingIn={signingIn()} onSignIn={() => setSigningIn(true)} />
      </ComposerStack>
    );
  },
};

export const UsageLimitReached: Story = {
  render: () => {
    const [dismissed, setDismissed] = createSignal(false);
    return (
      <ComposerStack>
        <Show when={!dismissed()}>
          <ComposerUsageLimitNotice provider="codex" resetsAt={USAGE_RESETS_AT} onDismiss={() => setDismissed(true)} />
        </Show>
      </ComposerStack>
    );
  },
};

export const UsageLimitOnCredits: Story = {
  render: () => {
    const [dismissed, setDismissed] = createSignal(false);
    return (
      <ComposerStack>
        <Show when={!dismissed()}>
          <ComposerUsageLimitNotice
            provider="codex"
            resetsAt={USAGE_RESETS_AT}
            onCredits
            onDismiss={() => setDismissed(true)}
          />
        </Show>
      </ComposerStack>
    );
  },
};

export const UsageLimitWithoutReset: Story = {
  render: () => {
    const [dismissed, setDismissed] = createSignal(false);
    return (
      <ComposerStack>
        <Show when={!dismissed()}>
          <ComposerUsageLimitNotice provider="claude" resetsAt={null} onDismiss={() => setDismissed(true)} />
        </Show>
      </ComposerStack>
    );
  },
};

export const UpdateRequired: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUpdateNotice provider="codex" onUpdate={fn()} />
    </ComposerStack>
  ),
};

export const Updating: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUpdateNotice provider="codex" onUpdate={fn()} updating />
    </ComposerStack>
  ),
};

export const ManualUpdateRequired: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUpdateNotice provider="codex" />
    </ComposerStack>
  ),
};
