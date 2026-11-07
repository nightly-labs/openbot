import type { ConversationSubagent, ConversationSubagentStep } from "@openbot/contracts/ipc";
import { type AgentWorkNode, AgentWorkPane } from "@openbot/ui/features/tasks/AgentWork";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

/*
 * The work of one agent, in the Work pane of the side panel: the main chat and the open threads, with
 * the subagents and the teammates that each one started. The story has the default width of the panel.
 */

const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1_000).toISOString();

function steps(id: string, items: [ConversationSubagentStep["kind"], string][]): ConversationSubagentStep[] {
  return items.map(([kind, text], index) => ({ id: `${id}:${index}`, kind, text }));
}

function subagent(
  id: string,
  title: string,
  status: ConversationSubagent["status"],
  options: { agentId: string; agentType?: string; started: number; ended?: number; error?: string },
  items: [ConversationSubagentStep["kind"], string][],
): AgentWorkNode {
  const startedAt = ago(options.started);
  const endedAt = status === "running" ? null : ago(options.ended ?? 0);
  return {
    id,
    kind: "subagent",
    title,
    state: status,
    note: options.error,
    agentId: options.agentId,
    startedAt,
    endedAt,
    subagent: {
      id,
      title,
      agentType: options.agentType ?? "general-purpose",
      prompt: `${title}. Give the source of each finding. Do not change files.`,
      status,
      startedAt,
      endedAt,
      steps: steps(id, items),
      error: options.error ?? null,
    },
    children: [],
  };
}

const WORK: AgentWorkNode[] = [
  {
    id: "chat",
    kind: "chat",
    title: "",
    state: "waiting",
    agentId: "chief",
    children: [
      {
        id: "launch:research",
        kind: "teammate",
        title: "Check the four sources of the launch plan",
        state: "completed",
        agentId: "research",
        children: [],
      },
      {
        id: "launch:sales",
        kind: "teammate",
        title: "Draft follow-ups for the launch list",
        state: "running",
        agentId: "sales",
        startedAt: ago(1_190),
        children: [
          subagent(
            "sales-contacts",
            "Find the contacts who opened the last email",
            "running",
            { agentId: "sales", agentType: "Explore", started: 410 },
            [
              ["thinking", "The CRM export has an opened column. I filter on it first."],
              ["read", "crm-export.csv"],
            ],
          ),
          subagent(
            "sales-limits",
            "Check the send limits of the mail account",
            "completed",
            { agentId: "sales", started: 900, ended: 780 },
            [
              ["web", "https://example.com/mail/limits"],
              ["text", "The account can send 500 messages a day. The list has 212 contacts."],
            ],
          ),
        ],
      },
    ],
  },
  {
    id: "competitors",
    kind: "task",
    title: "Competitor scan",
    state: "running",
    note: "Reading three pricing pages",
    agentId: "chief",
    children: [
      subagent(
        "competitors-pages",
        "Read the pricing pages of three competitors",
        "running",
        { agentId: "chief", agentType: "Explore", started: 540 },
        [
          ["thinking", "Prices change often, so I use the pricing pages and not news articles."],
          ["web", "https://example.com/pricing"],
        ],
      ),
      {
        id: "prices:research",
        kind: "teammate",
        title: "Find public prices for five more apps",
        state: "running",
        agentId: "research",
        startedAt: ago(500),
        children: [
          subagent(
            "research-signin",
            "Read the plan limits behind the sign-in",
            "failed",
            { agentId: "research", started: 460, ended: 380, error: "The page asked for a sign-in." },
            [["web", "https://example.com/app/billing"]],
          ),
        ],
      },
    ],
  },
  {
    id: "links",
    kind: "task",
    title: "Check broken links",
    state: "queued",
    agentId: "chief",
    startedByAgent: true,
    children: [],
  },
  {
    id: "release",
    kind: "task",
    title: "Release notes draft",
    state: "failed",
    note: "The provider stopped the turn: usage limit reached.",
    agentId: "chief",
    children: [
      subagent(
        "release-collect",
        "Collect the changelog.d entries",
        "completed",
        { agentId: "chief", started: 1_480, ended: 1_420 },
        [
          ["command", "git log v0.41.0..HEAD --oneline"],
          ["text", "34 entries since v0.41.0."],
        ],
      ),
      subagent(
        "release-group",
        "Group the entries by area",
        "stopped",
        { agentId: "chief", started: 1_410, ended: 1_320 },
        [["thinking", "Three groups: New, Better and Fixed."]],
      ),
    ],
  },
];

const meta = {
  title: "Tasks/Agent work",
  component: AgentWorkPane,
  render: (args) => (
    <div style={{ display: "flex", "flex-direction": "column", width: "380px", height: "100vh" }}>
      <AgentWorkPane {...args} />
    </div>
  ),
  args: {
    agentId: "chief",
    agents: STORY_AGENTS,
    nodes: WORK,
    onOpen: fn(),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AgentWorkPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The main chat waits for two teammates; one thread works, one waits, one failed. */
export const Working: Story = {};

/** Only the main chat, with nothing that works. */
export const Idle: Story = {
  args: { nodes: [{ id: "chat", kind: "chat", title: "", state: "completed", agentId: "chief", children: [] }] },
};
