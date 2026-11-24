import { type BugReport, type FeatureRequest, type Feedback, feedbackPreview } from "@openbot/contracts/feedback";
import type { AgentApproval } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

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
      <div style={{ width: "340px", "max-width": "100%" }}>
        <Story />
      </div>
    ),
  ],
};
export const AlwaysAllow: Story = {
  args: { agentName: "Chief", onAlwaysAllow: fn(async () => false) },
};
export const WithoutAlwaysAllow: Story = { args: { agentName: "Chief" } };

const sentFacts = {
  platform: "macOS",
  installSource: "Other",
  version: "0.65.0",
  os: "macOS 26.1 (arm64)",
  provider: "Claude (Claude Code)",
  providerVersion: "2.3.1",
  model: "claude-opus-5-5",
  effort: "high",
  host: "Desktop app",
  surface: null,
  foundBy: "user",
  recentErrors: "",
  sameAs: null,
} as const;
const bugReport: BugReport = {
  kind: "bug",
  ...sentFacts,
  title: "The chat stops scrolling after a long reply",
  area: "Conversations and messages",
  severity: "Works, but incorrectly or slowly",
  frequency: null,
  regression: null,
  description:
    "After a long reply, the chat stops moving down with new text. I expected to see the newest message without scrolling.",
  reproduction: "1. Ask for a long answer.\n2. Send a second message while the answer is still coming.",
  phone: null,
};
const featureRequest: FeatureRequest = {
  kind: "idea",
  ...sentFacts,
  title: "Save a chat as a PDF",
  type: "New feature",
  proposal: "Let me save a whole chat as a PDF file, with the pictures in it.",
  problem: "I send the plans that my agent writes to my team, and I copy them by hand now.",
};
const feedbackApproval = (text: string, reason = sourceText("status.agent.reportProblem")): AgentApproval => ({
  ...approval,
  kind: "permissions",
  command: text,
  cwd: null,
  reason,
});
const preview = (feedback: Feedback) =>
  feedbackPreview(feedback, {
    recentErrors: sourceText("status.agent.feedbackRecentErrors"),
    sameAs: (issue) => sourceText("status.agent.feedbackSameAs", { issue: String(issue) }),
  });
export const ReportProblem: Story = {
  args: { agentName: "Chief", approval: feedbackApproval(preview(bugReport)) },
};
export const SendIdea: Story = {
  args: {
    agentName: "Chief",
    approval: feedbackApproval(preview(featureRequest), sourceText("status.agent.sendIdea")),
  },
};
export const ReportProblemWithErrors: Story = {
  args: {
    agentName: "Chief",
    approval: feedbackApproval(
      preview({
        ...bugReport,
        recentErrors: "openbot.history_search: The query is too long.\nThe provider stopped: 529 Overloaded",
        sameAs: 6812,
      }),
    ),
  },
};
export const ReportPhoneProblem: Story = {
  args: {
    agentName: "Chief",
    approval: feedbackApproval(
      preview({
        ...bugReport,
        title: "The phone app stays on Reconnecting with a VPN on",
        surface: "Phone app",
        area: "Phone app and pairing",
        description:
          "The phone app shows Reconnecting and never connects while my VPN is on. I expected it to connect.",
        reproduction: "1. Turn on the VPN on the phone.\n2. Open the OpenBot app.",
      }),
      sourceText("status.agent.reportPhoneProblem"),
    ),
  },
};
export const SendingFeedback: Story = {
  args: { agentName: "Chief", approval: feedbackApproval(preview(bugReport)), sending: true },
};
