import { ConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS, storyRuntimeSettings } from "./fixtures";

const meta = {
  title: "Conversation/Header",
  component: ConversationHeader,
  args: {
    agent: STORY_AGENT,
    onSettingsIntent: fn(),
    onOpenSettings: fn(),
    modelPicker: {
      provider: storyRuntimeSettings(STORY_AGENT).provider,
      value: STORY_AGENT.model,
      reasoningEffort: STORY_AGENT.reasoningEffort,
      modelOptions: STORY_MODELS,
      agentStatus: STORY_AGENT_STATUS,
      onChange: fn(),
      onReasoningEffortChange: fn(),
    },
    sidePanel: { open: false, onToggle: fn() },
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
  },
};
export const AgentUsingBrowser: Story = {
  args: { sidePanel: { open: true, actingAgentName: STORY_AGENT.name, onToggle: fn() } },
};
/** A model chosen during the turn. The picker names it; the badge says that it starts with the next turn. */
export const ModelAfterThisTurn: Story = {
  args: {
    pendingModel: { running: "GPT-5.6 Luna", next: "GPT-5.6 Terra" },
    modelPicker: {
      provider: STORY_AGENT.provider,
      value: "gpt-5.6-terra",
      reasoningEffort: STORY_AGENT.reasoningEffort,
      modelOptions: STORY_MODELS,
      agentStatus: STORY_AGENT_STATUS,
      onChange: fn(),
      onReasoningEffortChange: fn(),
    },
  },
};
/** A provider chosen during the turn. The running turn keeps its provider; the next turn uses the new one. */
export const ProviderAfterThisTurn: Story = {
  args: {
    pendingModel: { running: "Codex · GPT-5.6 Luna", next: "Grok · Grok 4.6" },
    modelPicker: {
      provider: "grok",
      value: "grok-4.6",
      reasoningEffort: STORY_AGENT.reasoningEffort,
      modelOptions: STORY_MODELS,
      agentStatus: STORY_AGENT_STATUS,
      accountChoice: true,
      onChange: fn(),
      onReasoningEffortChange: fn(),
    },
  },
};
