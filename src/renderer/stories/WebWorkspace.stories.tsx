import { expect } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { WebWorkspace } from "../src/features/web-client/WebWorkspace";
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
      <WebWorkspace {...args} />
    </div>
  ),
} satisfies Meta<typeof WebWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("textbox", { name: "Message Chief" })).toBeVisible();
  },
};
