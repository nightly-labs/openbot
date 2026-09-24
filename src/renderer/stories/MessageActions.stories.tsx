import type { AgentMessage } from "@openbot/ui/data";
import { MessageActions } from "@openbot/ui/features/conversation/MessageRendering";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const message: AgentMessage = {
  id: "message-actions-1",
  author: "agent",
  body: "A message with available actions.",
  time: "10:00",
};

const args: Parameters<typeof MessageActions>[0] = {
  message,
  pickerOpen: false,
  moreOpen: false,
  expandedEmoji: false,
  copied: false,
  onTogglePicker: fn(),
  onToggleMore: fn(),
  onExpandEmoji: fn(),
  onReact: fn(),
  onReply: fn(),
  onCopy: fn(),
};

const meta = {
  title: "Conversation/MessageActions",
  component: MessageActions,
  args,
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof MessageActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReactionPicker: Story = {
  args: { pickerOpen: true },
};

export const MoreMenu: Story = {
  args: { moreOpen: true },
};

export const PreviewOnly: Story = {
  args: { reactions: false, onReply: undefined },
};
