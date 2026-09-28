import { Toaster } from "@openbot/ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { WebWorkspace } from "../src/features/web-client/WebWorkspace";
import type { WebRuntimeFactory } from "../src/features/web-client/web-client-context";
import { WebHostIncompatibleError } from "../src/features/web-client/web-runtime";
import { createMockWebRuntime } from "../src/preview/mock-web-runtime";
import "../src/features/web-client/web-client.css";

const meta = {
  title: "Web/Workspace",
  component: WebWorkspace,
  parameters: { layout: "fullscreen" },
  args: {
    accountId: "preview-account",
    accountFetch: fetch,
    onSessionCheck: async () => {},
    onLogout: async () => {},
    createRuntime: createMockWebRuntime,
  },
  render: (args) => (
    <div class="web-app">
      <Toaster />
      <WebWorkspace {...args} />
    </div>
  ),
} satisfies Meta<typeof WebWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

const noHostRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  listHosts: async () => [],
});

const failedHostsRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  listHosts: async () => {
    throw new Error("Host directory unavailable.");
  },
});

const otherTabRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  connect: async () => {
    throw new Error("This host is open in another tab. Close that connection before trying again.");
  },
});

const incompatibleRuntime: WebRuntimeFactory = (...args) => ({
  ...createMockWebRuntime(...args),
  connect: async () => {
    throw new WebHostIncompatibleError({
      appVersion: "0.40.0",
      protocol: { minimum: 1, maximum: 2 },
      capabilities: [],
    });
  },
});

export const NoHost: Story = {
  args: { accountEmail: "you@example.com", createRuntime: noHostRuntime },
};

export const HostsFailed: Story = {
  args: { accountEmail: "you@example.com", createRuntime: failedHostsRuntime },
};

export const Disconnected: Story = {
  args: { accountEmail: "you@example.com", createRuntime: otherTabRuntime },
};

export const Incompatible: Story = {
  args: { accountEmail: "you@example.com", createRuntime: incompatibleRuntime },
};
