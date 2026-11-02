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
  onOpenLink: fn(),
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

export const MarkdownInstructions: Story = {
  args: {
    detail: {
      ...STORY_AGENT_TEMPLATE_DETAIL,
      description:
        "## Identity and Mission\n\nKeep the **systems** healthy. Read the [runbook](https://example.com/runbook) first.\n\n## 1. Operating Principles\n\n- Prefer actual system state over assumptions.\n- Report what changed.\n\n1. Check the logs.\n2. Fix the cause.\n\n<script>alert(1)</script>",
    },
  },
};

export const Loading: Story = { args: { detail: null, loading: true } };

export const InstallFails: Story = {
  args: {
    onInstall: fn(async () => {
      throw new Error("Sign in to add this agent.");
    }),
  },
};
