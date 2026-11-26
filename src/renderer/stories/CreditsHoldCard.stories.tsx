import type { AgentApproval, CreditsHold, CreditsHoldAction } from "@openbot/contracts/ipc";
import { Toaster } from "@openbot/ui";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import type { MediaApprovalControls } from "@openbot/ui/features/conversation/MediaApprovalCard";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

const AGENT = STORY_AGENTS[0];

const approval: AgentApproval = {
  requestId: "credits-hold-story",
  agentId: AGENT?.id ?? "agent-story",
  threadId: "thread-story",
  turnId: "turn-story",
  kind: "permissions",
  command: null,
  cwd: null,
  reason: "This uses 7.1 credits, and the balance is 2.4 credits.",
  grantRoot: null,
  permissions: null,
};

const BALANCE: CreditsHold = {
  reason: "balance",
  images: 1,
  videos: 0,
  cost: 7.1,
  balance: 2.4,
  canEnable: true,
};

function controls(hold: CreditsHold): MediaApprovalControls {
  return {
    read: fn(async () => ({ media: null, hold })),
    allow: fn(async () => false),
    hold: {
      agent: () => AGENT,
      balance: () => hold.balance,
      buy: fn(),
      respond: fn(async (_approval: AgentApproval, action: CreditsHoldAction) => (action === "continue" ? hold : null)),
      unmute: fn(async () => undefined),
    },
  };
}

const meta = {
  title: "Conversation/CreditsHoldCard",
  component: ApprovalCard,
  args: {
    approval,
    onApprove: fn(async () => false),
    onReject: fn(async () => false),
    media: controls(BALANCE),
  },
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
        <Toaster />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ApprovalCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Balance: Story = {};
export const ManyImages: Story = {
  args: { media: controls({ ...BALANCE, images: 3, cost: 21.3 }) },
};
export const ImagesAndVideos: Story = {
  args: { media: controls({ ...BALANCE, images: 2, videos: 1, cost: 222.2 }) },
};
export const AgentsOff: Story = {
  args: { media: controls({ ...BALANCE, reason: "agentsOff", balance: null }) },
};
export const AgentsOffMember: Story = {
  args: { media: controls({ ...BALANCE, reason: "agentsOff", balance: null, canEnable: false }) },
};
