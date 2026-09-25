import { Toaster } from "@openbot/ui";
import { AgentTemplateInstallDialog } from "@openbot/ui/features/agents/AgentTemplateInstallDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_TEMPLATE_DETAIL } from "../src/preview/agent-template-fixtures";

const args: Parameters<typeof AgentTemplateInstallDialog>[0] = {
  open: true,
  onOpenChange: fn(),
  detail: STORY_AGENT_TEMPLATE_DETAIL,
  loading: false,
  onInstall: fn(async () => undefined),
};

const meta = {
  title: "Agents/AgentTemplateInstallDialog",
  component: AgentTemplateInstallDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
} satisfies Meta<typeof AgentTemplateInstallDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = { args: { detail: null, loading: true } };

export const InstallFails: Story = {
  args: {
    onInstall: fn(async () => {
      throw new Error("Sign in to add this agent.");
    }),
  },
};
