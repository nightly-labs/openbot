import { ConversationHeader } from "@openbot/ui/features/conversation/ConversationHeader";
import type { PinnedMessageItem } from "@openbot/ui/features/conversation/PinnedMessages";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_AGENTS, STORY_MODELS, storyRuntimeSettings } from "./fixtures";

const STORY_PINS: PinnedMessageItem[] = [
  {
    id: "pin-checklist",
    author: STORY_AGENT.name,
    time: "18 Aug, 08:36",
    thread: null,
    pinnedBy: STORY_AGENT.name,
    body: "**Launch day checklist**\n\n1. 08:00: freeze `main` and tag the release candidate.\n2. 08:20: smoke test the macOS, Windows and Linux builds.\n3. 08:40: publish the blog post as a draft and check the links.\n4. 09:00: publish the release, the blog post and the X thread.\n5. 09:30: watch the crash reports and the support inbox for one hour.",
  },
  {
    id: "pin-staging",
    author: STORY_AGENT.name,
    time: "17 Aug, 10:18",
    thread: "Staging review",
    pinnedBy: null,
    body: "Staging is ready for review.\n\n- URL: `staging.openbot.run`\n- Test account: `launch-review@openbot.run`\n- Password: in the shared vault, item **Staging review**",
  },
  {
    id: "pin-launch-date",
    author: "You",
    time: "17 Aug, 09:02",
    thread: null,
    pinnedBy: null,
    body: "The launch date is fixed: **Tuesday 1 September, 09:00 CET**. Ask me before you move anything that depends on it.",
  },
];

/** 50 pins of several chats, with short, long and unbroken messages and long thread names. */
const MANY_STORY_PINS: PinnedMessageItem[] = Array.from({ length: 50 }, (_, index) => {
  const base = STORY_PINS[index % STORY_PINS.length] ?? {
    id: "pin",
    author: "You",
    time: "",
    body: "",
    thread: null,
    pinnedBy: null,
  };
  const body =
    index % 7 === 3
      ? "ok"
      : index % 7 === 5
        ? `https://staging.openbot.run/review/${"launch-checklist-".repeat(12)}${index}`
        : `${base.body}\n\n${"The reviewers read each step again before the release and report every difference. ".repeat(index % 4)}`;
  const thread =
    index % 6 === 4 ? `Release notes for the macOS, Windows and Linux builds of version 0.${index}` : base.thread;
  return { ...base, id: `pin-${index}`, body, thread };
});

const pinnedMessages = (pins: PinnedMessageItem[]) => ({ pins, agents: STORY_AGENTS, onJump: fn(), onUnpin: fn() });

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
/** The pin button with three pins. Open the list: each pin is a quote, and Unpin shows on hover. */
export const PinnedMessages: Story = { args: { pinnedMessages: pinnedMessages(STORY_PINS) } };
/** A chat at its limit of 50 pins. The list scrolls under its title, and each quote stays at four lines. */
export const ManyPinnedMessages: Story = { args: { pinnedMessages: pinnedMessages(MANY_STORY_PINS) } };
/** A chat with no pin. The list says how to pin a message. */
export const NoPinnedMessages: Story = { args: { pinnedMessages: pinnedMessages([]) } };
