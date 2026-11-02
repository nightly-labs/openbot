import type { BrowserTakeoverRequest, QueueDelivery } from "@openbot/contracts/ipc";
import { BrowserDock } from "@openbot/ui/features/browser/BrowserDock";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { requireFixture, STORY_AGENTS } from "./fixtures";

const chief = requireFixture(STORY_AGENTS[0], "Story agent 0");

function delivery(id: string, text: string, position: number): QueueDelivery {
  return {
    id,
    messageId: `message-${id}`,
    recipientAgentId: chief.id,
    sender: { kind: "user" },
    text,
    attachments: [],
    replyToMessageId: null,
    status: "queued",
    position,
    turnId: null,
    error: null,
    createdAt: new Date("2026-10-17T09:00:00.000Z").toISOString(),
  };
}

const secretRequest: BrowserTakeoverRequest = {
  requestId: "authentication",
  agentId: chief.id,
  threadId: "thread-chief",
  turnId: "turn-auth",
  tabId: "tab-docs",
  secret: { method: "otp", origin: "https://accounts.example.com", digits: 6 },
};

const meta = {
  title: "Conversation/BrowserDock",
  component: BrowserDock,
  args: {
    agent: chief,
    agents: STORY_AGENTS,
    value: "",
    working: false,
    deliveries: [],
    canSteer: false,
    island: null,
    onValueChange: fn(),
    onSend: fn(),
    onStop: fn(),
    onSteer: fn(),
    onCancel: fn(),
    onEdit: fn(),
    onCancelEdit: fn(),
    onReorder: fn(),
    onRespondSecret: fn(async () => undefined),
    onDismissReply: fn(),
    onOpenChat: fn(),
    onSelectAgent: fn(),
    onOpenLink: fn(),
  },
  decorators: [
    (Story) => (
      <div class="browser-full-surface" style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserDock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The composer alone, with no turn and no queue. */
export const Idle: Story = {};

/** The agent acts on the page. The island shows the step and offers to take over. */
export const AgentActing: Story = {
  args: {
    working: true,
    canSteer: true,
    island: { kind: "activity", control: "agent", label: "Clicking “Sign in”" },
    onHandoff: fn(),
    deliveries: [
      delivery("one", "Then open the pricing page", 1),
      delivery("two", "Compare the yearly plans and tell me the cheapest one with SSO", 2),
    ],
  },
};

/** The user controls the page. The agent waits until the user gives it back. */
export const UserControl: Story = {
  args: { working: true, island: { kind: "activity", control: "user" }, onHandoff: fn() },
};

/** The agent asks for a code that only the user has. */
export const SecretRequest: Story = {
  args: { working: true, island: { kind: "secret", request: secretRequest } },
};

/** The agent's answer, which closes by itself. */
export const Reply: Story = {
  args: {
    island: {
      kind: "reply",
      id: "reply-1",
      body: "The Team plan is the cheapest with SSO: 12 € per seat each month, billed yearly.",
    },
  },
};
