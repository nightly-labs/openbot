import { McpSignInCard } from "@openbot/ui/features/conversation/McpSignInCard";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/MCP sign-in",
  component: McpSignInCard,
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <McpSignInCard {...args} />
    </main>
  ),
  args: {
    name: "example",
    address: "https://example.com/mcp",
    state: "sign-in",
    unavailableText: "Sign in to example in OpenBot on your computer, in Marketplace, Apps, example.",
    notNeededText: "example works now without a sign-in.",
    onSignIn: fn(),
    onContinue: fn(),
  },
  argTypes: {
    state: {
      control: "select",
      options: ["sign-in", "checking", "signed-in", "not-needed", "sent", "not-needed-sent", "unavailable"],
    },
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof McpSignInCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {};

export const SignedIn: Story = { args: { state: "signed-in" } };

export const Sent: Story = { args: { state: "sent" } };

export const Checking: Story = { args: { state: "checking" } };

export const NotNeeded: Story = { args: { state: "not-needed" } };

export const NotNeededSent: Story = { args: { state: "not-needed-sent" } };

export const Unavailable: Story = { args: { state: "unavailable", onSignIn: undefined } };
