import type { AgentApproval } from "@openbot/contracts/ipc";
import { fn, userEvent, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ApprovalCard } from "../src/features/conversation/ConversationPrompts";

const approval: AgentApproval = {
  requestId: "approval-story",
  agentId: "agent-story",
  threadId: "thread-story",
  turnId: "turn-story",
  kind: "command",
  command: "bun run lint",
  cwd: "~/OpenBot/Agents/agent-story/project",
  reason: "Check the project before continuing.",
  grantRoot: null,
  permissions: null,
};

const meta = {
  title: "Conversation/ApprovalCard",
  component: ApprovalCard,
  args: { approval, onApprove: fn(async () => false), onReject: fn(async () => false) },
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ApprovalCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Command: Story = {};
export const FileChange: Story = {
  args: {
    approval: {
      ...approval,
      kind: "file-change",
      command: null,
      cwd: null,
      grantRoot: "~/OpenBot/Agents/agent-story/project",
      reason: "Update the project files.",
    },
  },
};
export const Permissions: Story = {
  args: {
    approval: {
      ...approval,
      kind: "permissions",
      command: null,
      cwd: null,
      reason: "Read the source files and download dependencies.",
      permissions: {
        fileSystem: { read: ["~/Projects/site"], write: ["~/Projects/site/node_modules"] },
        network: true,
      },
    },
  },
};
export const Minimal: Story = {
  args: { approval: { ...approval, command: null, cwd: null, reason: null } },
};
export const LongContent: Story = {
  args: {
    approval: {
      ...approval,
      command:
        "bun run test:desktop -- src/renderer/src/features/conversation/ConversationPrompts.test.tsx src/renderer/src/components/QuestionPromptBubble.test.tsx",
      cwd: "~/OpenBot/Agents/agent-story/projects/a-project-with-a-long-directory-name/packages/desktop",
      reason: "Run the conversation interaction checks before sharing the updated project with the team.",
    },
  },
};
export const Narrow: Story = {
  ...Permissions,
  decorators: [
    (Story) => (
      <div style={{ width: "280px", "max-width": "100%" }}>
        <Story />
      </div>
    ),
  ],
};
export const Pending: Story = {
  args: { onApprove: fn(async () => true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Allow" }));
  },
};
