import { Toaster } from "@openbot/ui";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { WebWorkspace } from "../src/features/web-client/WebWorkspace";
import type { WebRuntimeFactory } from "../src/features/web-client/web-client-context";
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

export const NoHost: Story = {
  args: { accountEmail: "you@example.com", createRuntime: noHostRuntime },
};

export const HostsFailed: Story = {
  args: { accountEmail: "you@example.com", createRuntime: failedHostsRuntime },
};
