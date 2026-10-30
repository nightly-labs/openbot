import type { AgentApproval, AgentTask, ConversationSnapshot } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TasksView } from "../src/features/tasks/TasksView";
import { desktopTasksSource } from "../src/features/tasks/tasks-port";
import { PlatformProvider } from "../src/platform";
import { requireFixture, STORY_AGENTS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

/*
 * The Tasks page of a server: a composer that starts a task for one agent, and the tasks of all agents
 * by what they need. A row opens the task beside the list. The preview mock runs each turn.
 */

const MINUTE = 60_000;
/* The real clock, so the times read as recent. */
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString();

const TASK_AGENTS: AgentProfile[] = ["chief", "research", "sales"].map((id) =>
  requireFixture(
    STORY_AGENTS.find((agent) => agent.id === id),
    id,
  ),
);

/** More agents than the window has rows, so the agent menu scrolls. */
const MANY_AGENTS: AgentProfile[] = Array.from({ length: 30 }, (_, index) => {
  const agent = requireFixture(STORY_AGENTS[index % STORY_AGENTS.length], "Story agent");
  return { ...agent, id: `${agent.id}-${index}`, name: `${agent.name} ${index + 1}` };
});

type TaskSeed = Pick<AgentTask, "id" | "agentId" | "title" | "state"> & Partial<AgentTask>;

function seedTask(seed: TaskSeed): AgentTask {
  return {
    threadId: `${seed.id}-thread`,
    origin: "user",
    outcome: null,
    hold: null,
    activeTurnId: seed.state === "running" ? `${seed.id}-turn` : null,
    progress: null,
    error: null,
    queuedMessages: [],
    createdAt: ago(240),
    updatedAt: ago(10),
    closedAt: null,
    ...seed,
  };
}

/** Every state, long titles, and closed tasks over three days. */
const TASKS: AgentTask[] = [
  seedTask({
    id: "task-board-update",
    agentId: "chief",
    title: "Draft the Q4 board update from the finance notes and last month's product metrics",
    state: "running",
    progress: "Reading finance-notes.md",
    updatedAt: ago(1),
  }),
  seedTask({
    id: "task-hiring-loops",
    agentId: "chief",
    title: "Summarise the open hiring loops for the design lead role",
    state: "idle",
    outcome: "completed",
    updatedAt: ago(6),
  }),
  seedTask({
    id: "task-lease-offers",
    agentId: "chief",
    title: "Compare the three office lease offers and list the risks of each",
    state: "queued",
    hold: "task-limit",
    queuedMessages: [
      {
        deliveryId: "delivery-lease",
        text: "Compare the three office lease offers and list the risks of each",
        createdAt: ago(3),
      },
    ],
    updatedAt: ago(3),
  }),
  seedTask({
    id: "task-papers",
    agentId: "research",
    title: "Find recent papers on retrieval for long documents",
    state: "running",
    progress: "Searching arxiv.org",
    updatedAt: ago(2),
  }),
  seedTask({
    id: "task-citations",
    agentId: "research",
    title: "Pull the citation counts for the twelve papers in the reading list",
    state: "idle",
    outcome: "failed",
    error: "Semantic Scholar returned 429 Too Many Requests.",
    updatedAt: ago(14),
  }),
  seedTask({
    id: "task-benchmarks",
    agentId: "research",
    origin: "agent",
    title: "Check the benchmark numbers in the draft against the source tables",
    state: "idle",
    updatedAt: ago(20),
  }),
  seedTask({
    id: "task-crm-cleanup",
    agentId: "sales",
    title: "Clean the CRM export and remove duplicate contacts",
    state: "idle",
    outcome: "interrupted",
    updatedAt: ago(48),
  }),
  seedTask({
    id: "task-offsite",
    agentId: "chief",
    title: "Make a shortlist of venues for the team offsite",
    state: "closed",
    outcome: "completed",
    closedAt: ago(75),
  }),
  seedTask({
    id: "task-northwind",
    agentId: "sales",
    title: "Prepare the call notes for Northwind Traders",
    state: "closed",
    outcome: "completed",
    closedAt: ago(130),
  }),
  seedTask({
    id: "task-mamba",
    agentId: "research",
    title: "Read the Mamba paper and note the main claims",
    state: "closed",
    outcome: "completed",
    closedAt: ago(60 * 26),
  }),
];

const REPLIES: Record<string, string> = {
  "task-hiring-loops":
    "There are three open loops for the design lead role.\n\n- **Maya Chen**: on-site done, two strong yes, one lean yes. The offer call is the next step.\n- **Jonas Ferreira**: the portfolio review is on Thursday.\n- **Priya Natarajan**: waiting for her to choose a slot for the first call.\n\nMaya is the closest to an offer. Do you want me to draft it?",
  "task-citations": "I started to read the reading list, but the citation service stopped my requests.",
  "task-crm-cleanup": "I found 212 possible duplicates in the 4,180 contacts. I merged the first 40.",
  "task-offsite": "Here are four venues for 18 people on 12–13 November, with prices and travel times.",
  "task-northwind": "The call notes are ready: the account history, the open quote and three questions to ask.",
  "task-mamba": "The paper makes four main claims. I list them with the evidence for each.",
};

function conversationOf(task: AgentTask): ConversationSnapshot {
  const reply = REPLIES[task.id];
  return {
    agentId: task.agentId,
    threadId: task.threadId,
    activeTurnId: task.activeTurnId,
    revision: 1,
    messages: [
      {
        id: `${task.id}-ask`,
        author: "user",
        source: "user",
        text: task.title,
        createdAt: task.createdAt,
        status: "completed",
      },
      ...(reply
        ? [
            {
              id: `${task.id}-reply`,
              author: "assistant" as const,
              source: "assistant" as const,
              text: reply,
              createdAt: task.updatedAt,
              status: "completed" as const,
            },
          ]
        : []),
    ],
  };
}

function TasksPageStory(props: {
  tasks: readonly AgentTask[];
  approvals?: AgentApproval[];
  agents?: AgentProfile[];
  agentsToggle?: boolean;
}) {
  const previousApi = window.openbot;
  const [agentsOpen, setAgentsOpen] = createSignal(false);
  const tasks: Record<string, AgentTask[]> = {};
  for (const task of props.tasks) tasks[task.agentId] = [...(tasks[task.agentId] ?? []), task];
  const mock = createMockOpenBot({
    tasks,
    taskConversations: Object.fromEntries(props.tasks.map((task) => [task.id, conversationOf(task)])),
  });
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <PlatformProvider>
      <div style={{ height: "100vh" }}>
        <TasksView
          serverId="local"
          hostName="This computer"
          onBack={fn()}
          source={desktopTasksSource()}
          agents={props.agents ?? TASK_AGENTS}
          onOpenLink={fn()}
          onAttachmentAction={fn()}
          approvals={props.approvals ?? []}
          onRespondApproval={fn(async () => true)}
          agentsOpen={agentsOpen()}
          onToggleAgents={props.agentsToggle ? () => setAgentsOpen((open) => !open) : undefined}
        />
      </div>
    </PlatformProvider>
  );
}

const meta = {
  title: "Tasks/Tasks page",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The tasks of three agents. A send waits six seconds for Undo; a row opens the task beside the list. */
export const Default: Story = { render: () => <TasksPageStory tasks={TASKS} /> };
/** No tasks: only the composer. */
export const Empty: Story = { render: () => <TasksPageStory tasks={[]} /> };
/** Thirty agents: the agent menu fits the window and scrolls to the last agent. */
export const ManyAgents: Story = { render: () => <TasksPageStory tasks={[]} agents={MANY_AGENTS} /> };
/** In the app frame: the header button shows or hides the agent list. Its label follows the state. */
export const AgentListButton: Story = { render: () => <TasksPageStory tasks={TASKS} agentsToggle /> };

/** A running task asks to write outside its workspace. Its row and panel say that it waits for you. */
const WAITING_APPROVAL: AgentApproval = {
  requestId: "task-board-update-approval",
  agentId: "chief",
  threadId: "task-board-update-thread",
  turnId: "task-board-update-turn",
  kind: "file-change",
  command: null,
  cwd: "/Users/you/OpenBot/Agents/Chief",
  reason: "Save board-update.md on the Desktop",
  grantRoot: "/Users/you/Desktop",
  permissions: null,
};
export const WaitingForApproval: Story = {
  render: () => <TasksPageStory tasks={TASKS} approvals={[WAITING_APPROVAL]} />,
};
