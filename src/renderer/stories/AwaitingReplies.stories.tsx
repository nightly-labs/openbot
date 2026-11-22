import type { AgentProfile } from "@openbot/ui/data";
import { AwaitingReplies, type AwaitingReplyItem } from "@openbot/ui/features/conversation/AwaitingReplies";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "../src/preview/fixtures";

const research: AgentProfile = requireFixture(STORY_AGENTS[1], "Research agent");
const sales: AgentProfile = requireFixture(STORY_AGENTS[2], "Sales agent");

const researchReplied: AwaitingReplyItem = {
  id: "reply-research",
  agent: research,
  name: research.name,
  state: "replied",
  preview: "All four sources check out. The pricing link now points to the new page.",
  detail: "Chief reads it next",
};

const items: AwaitingReplyItem[] = [
  researchReplied,
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

export const Collapsed: Story = { args: { defaultOpen: false } };

export const OneFailed: Story = {
  args: {
    items: [
      { id: "reply-research", agent: research, name: research.name, state: "failed" },
      { id: "reply-sales", agent: sales, name: sales.name, state: "working" },
    ],
  },
};

export const AllReplied: Story = {
  args: {
    onDismiss: fn(),
    items: items.map((item) => ({ ...item, state: "replied", detail: "Chief reads it next" })),
  },
};

export const ChannelSubtasks: Story = {
  args: {
    title: "Waiting for sub-tasks",
    onStop: fn(),
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

export const StopAskedRequest: Story = {
  args: {
    onStop: fn(),
    stopDisplay: "icon",
    items: [
      researchReplied,
      { id: "reply-sales", agent: sales, name: sales.name, state: "working", stoppable: false },
      { id: "reply-support", name: "Support", state: "asked" },
      { id: "reply-design", name: "Design Review", state: "stopped", stoppable: false },
    ],
  },
};

export const NeedsApproval: Story = {
  args: {
    onOpenAgent: fn(),
    items: [
      researchReplied,
      {
        id: "reply-sales",
        agent: sales,
        name: sales.name,
        state: "working",
        wait: { kind: "waiting", reason: "approval", detail: "rm -r drafts/pricing-old" },
      },
    ],
  },
};

export const AsksQuestion: Story = {
  args: {
    onOpenAgent: fn(),
    items: [
      researchReplied,
      {
        id: "reply-sales",
        agent: sales,
        name: sales.name,
        state: "working",
        wait: { kind: "waiting", reason: "question", detail: "Which region should we launch in first?" },
      },
    ],
  },
};

export const SteerReply: Story = {
  args: {
    onSteer: fn(),
    items: [{ ...researchReplied, deliveryId: "delivery-research" }, ...items.slice(1)],
  },
};

export const UsageLimit: Story = {
  args: {
    onOpenAgent: fn(),
    items: [
      researchReplied,
      {
        id: "reply-sales",
        agent: sales,
        name: sales.name,
        state: "asked",
        wait: { kind: "limited", resetsAt: Math.floor(Date.now() / 1_000) + 2 * 60 * 60 },
      },
    ],
  },
};
