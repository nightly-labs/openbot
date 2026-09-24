import { ComposerSignInNotice, ComposerUsageLimitNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import type { JSX } from "@solidjs/web";
import { expect, fn } from "storybook/test";
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

/** The composer column, so the notice is judged at the width it actually renders at. */
function ComposerStack(props: { children: JSX.Element }) {
  return (
    <div class="composer-wrap" style={{ width: "640px", padding: "16px" }}>
      {props.children}
    </div>
  );
}

/** A fixed moment, so the story reads the same on every run and in every review screenshot. */
const USAGE_RESETS_AT = Date.UTC(2026, 8, 21, 9, 0) / 1_000;

export const SignInRequired: Story = {
  render: (args) => (
    <ComposerStack>
      <ComposerSignInNotice {...args} />
    </ComposerStack>
  ),
  play: async ({ args, canvas, userEvent }) => {
    const signIn = canvas.getByRole("button", { name: "Sign in to ChatGPT" });
    await expect(canvas.getByText("Sign in required")).toBeInTheDocument();
    await expect(canvas.getByText("Sign in to ChatGPT to send messages.")).toBeInTheDocument();
    await userEvent.click(signIn);
    await expect(args.onSignIn).toHaveBeenCalledWith("codex");
  },
};

export const ClaudeSignInRequired: Story = {
  args: { provider: "claude" },
  render: (args) => (
    <ComposerStack>
      <ComposerSignInNotice {...args} />
    </ComposerStack>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Sign in to Claude to send messages.")).toBeInTheDocument();
  },
};

/** The provider already reports `connecting`, so the action cannot be pressed a second time. */
export const SigningIn: Story = {
  args: { signingIn: true },
  render: (args) => (
    <ComposerStack>
      <ComposerSignInNotice {...args} />
    </ComposerStack>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Sign in to ChatGPT" })).toBeDisabled();
  },
};

/**
 * The gap between the press and the provider reporting `connecting`: the button holds its own
 * pending state so a slow main process never looks like an unpressed button.
 */
export const StartingSignIn: Story = {
  args: {
    onSignIn: fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }),
  },
  render: (args) => (
    <ComposerStack>
      <ComposerSignInNotice {...args} />
    </ComposerStack>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Sign in to ChatGPT" }));
    await expect(await canvas.findByRole("button", { name: "Sign in to ChatGPT" })).toBeDisabled();
    await expect(canvas.getByText("Signing in…")).toBeInTheDocument();
  },
};

/**
 * The plan window is spent. There is no button: only time or another model gives the user more
 * quota, so the card spends its width on the reset moment instead.
 */
export const UsageLimitReached: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUsageLimitNotice provider="codex" resetsAt={USAGE_RESETS_AT} />
    </ComposerStack>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Usage limit reached")).toBeInTheDocument();
    await expect(canvas.getByText(/You used all of your ChatGPT limit\. It resets /u)).toBeInTheDocument();
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};

/** Some providers report a spent window with no reset time, so the card names the way out instead. */
export const UsageLimitWithoutReset: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUsageLimitNotice provider="claude" resetsAt={null} />
    </ComposerStack>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("You used all of your Claude limit. Select a different model to continue."),
    ).toBeInTheDocument();
  },
};
