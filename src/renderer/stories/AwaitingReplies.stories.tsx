import type { AgentProfile } from "@openbot/ui/data";
import { AwaitingReplies, type AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "../src/preview/fixtures";

/*
 * The block above the composer while an agent waits for other agents. The agent chat shows the
 * agents it asked; a channel shows the sub-tasks that an owner waits for.
 */

const research: AgentProfile = requireFixture(STORY_AGENTS[1], "Research agent");
const sales: AgentProfile = requireFixture(STORY_AGENTS[2], "Sales agent");

const items: AwaitingReplyItem[] = [
  {
    id: "reply-research",
    agent: research,
    name: research.name,
    state: "replied",
    preview: "All four sources check out. The pricing link now points to the new page.",
    detail: "Chief reads it next",
  },
  { id: "reply-sales", agent: sales, name: sales.name, state: "working" },
  { id: "reply-support", name: "Support", state: "asked" },
];

const meta = {
  title: "Conversation/Awaiting replies",
  component: AwaitingReplies,
  render: (args) => (
    <main style={{ width: "min(640px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <AwaitingReplies {...args} />
    </main>
  ),
  args: { items },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof AwaitingReplies>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waiting: Story = {};

/** The person closed the block. The header names the agent that works. */
export const Collapsed: Story = { args: { defaultOpen: false } };

export const OneFailed: Story = {
  args: {
    items: [
      { id: "reply-research", agent: research, name: research.name, state: "failed" },
      { id: "reply-sales", agent: sales, name: sales.name, state: "working" },
    ],
  },
};

/** Every agent is done, so the block has a close button. */
export const AllReplied: Story = {
  args: {
    onDismiss: fn(),
    items: items.map((item) => ({ ...item, state: "replied", detail: "Chief reads it next" })),
  },
};

/** A channel owner that waits for the sub-tasks it gave out. */
export const ChannelSubtasks: Story = {
  args: {
    title: "Waiting for sub-tasks",
    items: [
      {
        id: "task-research",
        agent: research,
        name: research.name,
        state: "replied",
        preview: "Check the sources in the launch notes",
        detail: "Chief reads it next",
      },
      {
        id: "task-sales",
        agent: sales,
        name: sales.name,
        state: "working",
        preview: "Draft the pricing section for the launch post",
      },
    ],
  },
};
