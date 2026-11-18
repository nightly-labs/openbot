import { ServerInstallCard, type ServerInstallCardStep } from "@openbot/ui/features/conversation/ServerInstallCard";
import { createSignal, onSettled } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const SERVER = { id: "server-chat-smoke-two", logoUrl: null };

const meta = {
  title: "Conversation/Server install card",
  component: ServerInstallCard,
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <ServerInstallCard {...args} />
    </main>
  ),
  args: { step: "waiting", name: "Chat smoke two", server: null, onOpenServer: fn() },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ServerInstallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The agent has the command. The loader waits in the icon tile. */
export const Waiting: Story = {};

/** The new server signed in. Its logo is in the tile, with a spinner on its corner. */
export const Starting: Story = { args: { step: "starting", server: SERVER } };

/** The new server is online. */
export const Connected: Story = { args: { step: "connected", server: SERVER } };

/** The server signed in earlier, but it is not online now. */
export const Offline: Story = { args: { step: "offline", server: SERVER } };

/** Nobody used the command before it expired. */
export const Expired: Story = { args: { step: "expired" } };

/** The reveal as the chat shows it: the server signs in after 3 s and connects after 6 s. */
export const Reveal: Story = {
  render: (args) => {
    const [step, setStep] = createSignal<ServerInstallCardStep>("waiting");
    onSettled(() => {
      const signIn = window.setTimeout(() => setStep("starting"), 3000);
      const connect = window.setTimeout(() => setStep("connected"), 6000);
      return () => {
        window.clearTimeout(signIn);
        window.clearTimeout(connect);
      };
    });
    return (
      <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
        <ServerInstallCard
          step={step()}
          name={args.name}
          server={step() === "waiting" ? null : SERVER}
          onOpenServer={args.onOpenServer}
        />
      </main>
    );
  },
};
