import { ConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";

const meta = {
  title: "Conversation/Header",
  component: ConversationHeader,
  args: {
    agent: STORY_AGENT,
    onSettingsIntent: fn(),
    onOpenSettings: fn(),
    modelPicker: {
      provider: STORY_AGENT.provider,
      value: STORY_AGENT.model,
      reasoningEffort: STORY_AGENT.reasoningEffort,
      modelOptions: STORY_MODELS,
      agentStatus: STORY_AGENT_STATUS,
      onChange: fn(),
      onReasoningEffortChange: fn(),
    },
    browser: { acting: false, open: false, onToggle: fn() },
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ConversationHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WorkspaceOnly: Story = { args: { agent: { ...STORY_AGENT, access: "workspace" } } };
export const RemoteControl: Story = {
  args: { remoteControl: { enabled: true, active: true, visible: false, onOpen: fn() } },
};
export const OfflineHost: Story = {
  args: {
    remoteControl: { enabled: false, active: false, visible: false, onOpen: fn() },
    browser: { acting: false, open: false, disabled: true, onToggle: fn() },
  },
};
export const AgentUsingBrowser: Story = {
  args: { browser: { acting: true, agentName: STORY_AGENT.name, open: true, onToggle: fn() } },
};
