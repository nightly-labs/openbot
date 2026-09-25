import { PublishAgentDialog } from "@openbot/ui/features/agents/PublishAgentDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_TEMPLATE_PUBLICATION, storyAgentTemplatePreview } from "../src/preview/agent-template-fixtures";

const args: Parameters<typeof PublishAgentDialog>[0] = {
  open: true,
  onOpenChange: fn(),
  preview: storyAgentTemplatePreview("dr-eggbot"),
  loading: false,
  error: null,
  onPublish: fn(async () => undefined),
  onUnpublish: fn(async () => undefined),
  onCopyLink: fn(async () => undefined),
};

const meta = {
  title: "Agents/PublishAgentDialog",
  component: PublishAgentDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof PublishAgentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unpublished: Story = {};

export const Published: Story = {
  args: { preview: storyAgentTemplatePreview("dr-eggbot", STORY_AGENT_TEMPLATE_PUBLICATION) },
};

export const NoRoutinesOrSkills: Story = {
  args: { preview: { ...storyAgentTemplatePreview("dr-eggbot"), skills: [], routines: [] } },
};

export const Loading: Story = { args: { preview: null, loading: true } };

export const LoadFailed: Story = {
  args: { preview: null, error: "Choose a local agent first." },
};

export const PublishFails: Story = {
  args: {
    onPublish: fn(async () => {
      throw new Error("Remove the secret from the description before publishing.");
    }),
  },
};
