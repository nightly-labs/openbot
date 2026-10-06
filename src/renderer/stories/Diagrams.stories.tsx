/**
 * Diagrams: agents wired behind the routines that start them, on a canvas in the chat area, with
 * the last run beside it and an assistant that edits the diagram. The stories hold the diagram in
 * local state, so every edit on the canvas works; a run and the assistant are simulated on a timer.
 * The app logic and the runtime that executes a run are not wired yet.
 */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { DiagramView } from "@openbot/ui/features/diagrams/DiagramView";
import { diagramExecutionSteps } from "@openbot/ui/features/diagrams/diagram-graph";
import type {
  Diagram,
  DiagramChatMessage,
  DiagramNode,
  DiagramStepRun,
  DiagramSummary,
} from "@openbot/ui/features/diagrams/diagram-model";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import type { SidebarView } from "@openbot/ui/features/sidebar/sidebar-types";
import { createSignal, createStore, onCleanup, snapshot, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { requireFixture, STORY_AGENTS } from "./fixtures";

function storyAgent(id: string): AgentProfile {
  return requireFixture(
    STORY_AGENTS.find((agent) => agent.id === id),
    id,
  );
}

const chief = storyAgent("chief");
const research = storyAgent("research");
const sales = storyAgent("sales");
const writer: AgentProfile = {
  ...research,
  id: "writer",
  name: "Writer",
  title: "Brief writer",
  avatarSeed: "writer",
  avatarHue: null,
  threadId: "writer-thread",
};
const reviewer: AgentProfile = {
  ...chief,
  id: "reviewer",
  name: "Reviewer",
  title: "Fact checker",
  avatarSeed: "reviewer",
  avatarHue: null,
  threadId: "reviewer-thread",
};
const agents = [chief, research, sales, writer, reviewer];

const STARTED = "2026-10-06T05:00:00.000Z";
function at(seconds: number): string {
  return new Date(Date.parse(STARTED) + seconds * 1000).toISOString();
}

const nodes: DiagramNode[] = [
  {
    kind: "routine",
    id: "node-routine",
    position: { x: 0, y: 120 },
    name: "Morning brief",
    schedule: { kind: "weekdays", time: "07:00" },
    active: true,
    nextRunAt: "2026-10-07T05:00:00.000Z",
  },
  {
    kind: "agent",
    id: "node-research",
    position: { x: 336, y: 40 },
    agentId: "research",
    task: "Collect the market and product news since yesterday, with a source for each item.",
  },
  {
    kind: "agent",
    id: "node-sales",
    position: { x: 336, y: 304 },
    agentId: "sales",
    task: "List the deals that changed stage since yesterday and the next step for each.",
  },
  {
    kind: "agent",
    id: "node-writer",
    position: { x: 696, y: 160 },
    agentId: "writer",
    task: "Write one brief from the research and the pipeline. Keep it under 200 words.",
  },
  {
    kind: "agent",
    id: "node-chief",
    position: { x: 1056, y: 160 },
    agentId: "chief",
    task: "Read the brief, decide the three priorities for today and post them to the team.",
  },
  {
    kind: "agent",
    id: "node-reviewer",
    position: { x: 696, y: 480 },
    agentId: "reviewer",
    task: "Check each claim in the brief against its source.",
  },
];

const edges = [
  { id: "edge-1", from: "node-routine", to: "node-research" },
  { id: "edge-2", from: "node-routine", to: "node-sales" },
  { id: "edge-3", from: "node-research", to: "node-writer" },
  { id: "edge-4", from: "node-sales", to: "node-writer" },
  { id: "edge-5", from: "node-writer", to: "node-chief" },
];

const researchOutput = `1. Northwind cut its API prices by 20% (northwind.com/blog, 18:40).
2. The EU AI Act guidance for general-purpose models is final (europa.eu, 09:15).
3. Two competitors shipped agent canvases this week; both run in the cloud only.`;
const salesOutput = `- Contoso: moved to Negotiation. Next step: send the security review on Wednesday.
- Fabrikam: stalled for 9 days. Next step: call the champion.
- Tailspin: closed won, $48k ARR.`;
const writerOutput = `Morning brief, Tuesday

Market: Northwind cut API prices by 20%, which puts pressure on our usage tier. The EU guidance is final; nothing in it blocks local-first agents. Two competitors launched cloud-only canvases.

Pipeline: Tailspin closed ($48k). Contoso is in negotiation and waits for our security review. Fabrikam stalled.`;
const chiefOutput = `Priorities for today:
1. Send the Contoso security review (owner: Sales).
2. Draft a pricing answer to Northwind before Friday (owner: me).
3. Prepare a one-page note on why local-first matters for the canvas launch (owner: Writer).

Posted to #leadership.`;

function succeededSteps(): DiagramStepRun[] {
  return [
    step("node-research", "succeeded", "Morning brief fired at 07:00.", researchOutput, 0, 42),
    step("node-sales", "succeeded", "Morning brief fired at 07:00.", salesOutput, 0, 31),
    step(
      "node-writer",
      "succeeded",
      `From Research:\n${researchOutput}\n\nFrom Sales Outbound:\n${salesOutput}`,
      writerOutput,
      42,
      70,
    ),
    step("node-chief", "succeeded", `From Writer:\n${writerOutput}`, chiefOutput, 70, 95),
  ];
}

function step(
  nodeId: string,
  status: DiagramStepRun["status"],
  input: string | null,
  output: string | null,
  start: number | null,
  end: number | null,
  error: string | null = null,
): DiagramStepRun {
  return {
    nodeId,
    status,
    input,
    output,
    error,
    startedAt: start === null ? null : at(start),
    finishedAt: end === null ? null : at(end),
  };
}

const succeededDiagram: Diagram = {
  id: "diagram-morning",
  name: "Morning brief",
  nodes,
  edges,
  updatedAt: STARTED,
  lastRun: {
    id: "run-1",
    routineNodeId: "node-routine",
    kind: "scheduled",
    status: "succeeded",
    startedAt: STARTED,
    finishedAt: at(95),
    steps: succeededSteps(),
  },
};

const failedDiagram: Diagram = {
  ...succeededDiagram,
  lastRun: {
    id: "run-2",
    routineNodeId: "node-routine",
    kind: "manual",
    status: "failed",
    startedAt: STARTED,
    finishedAt: at(64),
    steps: [
      step("node-research", "succeeded", "Started by hand.", researchOutput, 0, 42),
      step(
        "node-sales",
        "failed",
        "Started by hand.",
        null,
        0,
        64,
        "The CRM connector is signed out. Reconnect it in Settings > Connectors.",
      ),
      step("node-writer", "skipped", null, null, null, null),
      step("node-chief", "skipped", null, null, null, null),
    ],
  },
};

const runningDiagram: Diagram = {
  ...succeededDiagram,
  lastRun: {
    id: "run-3",
    routineNodeId: "node-routine",
    kind: "scheduled",
    status: "running",
    startedAt: STARTED,
    finishedAt: null,
    steps: [
      step("node-research", "succeeded", "Morning brief fired at 07:00.", researchOutput, 0, 42),
      step("node-sales", "succeeded", "Morning brief fired at 07:00.", salesOutput, 0, 31),
      step(
        "node-writer",
        "running",
        `From Research:\n${researchOutput}\n\nFrom Sales Outbound:\n${salesOutput}`,
        null,
        42,
        null,
      ),
      step("node-chief", "waiting", null, null, null, null),
    ],
  },
};

const newDiagram: Diagram = { ...succeededDiagram, id: "diagram-new", lastRun: null };
const emptyDiagram: Diagram = {
  ...succeededDiagram,
  id: "diagram-empty",
  name: "Untitled diagram",
  nodes: [],
  edges: [],
  lastRun: null,
};

const assistantHistory: DiagramChatMessage[] = [
  {
    id: "m1",
    author: "user",
    text: "Every weekday at 7, collect the news and the pipeline, write one brief, and let Chief set priorities.",
    createdAt: at(-600),
  },
  {
    id: "m2",
    author: "agent",
    text: "Done. Research and Sales Outbound run side by side, then Writer joins their output for Chief.",
    changes: [
      "Added the routine Morning brief, weekdays at 7:00 AM",
      "Connected Research and Sales Outbound to Morning brief",
      "Added Writer after Research and Sales Outbound",
      "Added Chief after Writer",
    ],
    createdAt: at(-580),
  },
];

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** A diagram in local state. Every canvas edit applies; a run and the assistant run on timers. */
function InteractiveDiagram(props: { diagram: Diagram; assistant?: boolean; editable?: boolean }) {
  const [diagram, setDiagram] = createStore<Diagram>(structuredClone(untrack(() => props.diagram)));
  const [chat, setChat] = createStore({
    messages: structuredClone(assistantHistory),
    working: false,
  });
  const timers = new Set<number>();
  const later = (ms: number, action: () => void) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      action();
    }, ms);
    timers.add(timer);
  };
  onCleanup(() => {
    for (const timer of timers) window.clearTimeout(timer);
  });

  const runNow = (routineNodeId: string) => {
    const steps = diagramExecutionSteps(snapshot(diagram.nodes), snapshot(diagram.edges));
    const done = new Map(succeededSteps().map((entry) => [entry.nodeId, entry]));
    const order = [...steps.entries()].sort((left, right) => left[1] - right[1]);
    const startedAt = new Date().toISOString();
    setDiagram((state) => {
      state.lastRun = {
        id: nextId("run"),
        routineNodeId,
        kind: "manual",
        status: "running",
        startedAt,
        finishedAt: null,
        steps: order.map(([nodeId]) => step(nodeId, "waiting", null, null, null, null)),
      };
    });
    const levels = [...new Set(order.map(([, level]) => level))];
    levels.forEach((level, index) => {
      const ids = order.filter(([, value]) => value === level).map(([nodeId]) => nodeId);
      later(index * 1400 + 200, () =>
        setDiagram((state) => {
          for (const entry of state.lastRun?.steps ?? []) {
            if (!ids.includes(entry.nodeId)) continue;
            entry.status = "running";
            entry.input = done.get(entry.nodeId)?.input ?? "Started by hand.";
            entry.startedAt = new Date().toISOString();
          }
        }),
      );
      later(index * 1400 + 1400, () =>
        setDiagram((state) => {
          for (const entry of state.lastRun?.steps ?? []) {
            if (!ids.includes(entry.nodeId)) continue;
            entry.status = "succeeded";
            entry.output = done.get(entry.nodeId)?.output ?? "Done.";
            entry.finishedAt = new Date().toISOString();
          }
          if (index === levels.length - 1 && state.lastRun) {
            state.lastRun.status = "succeeded";
            state.lastRun.finishedAt = new Date().toISOString();
          }
        }),
      );
    });
  };

  const addAgentAfterLast = () => {
    const writerNode = diagram.nodes.find((node) => node.id === "node-writer");
    const id = nextId("node-reviewer");
    setDiagram((state) => {
      state.nodes.push({
        kind: "agent",
        id,
        position: { x: (writerNode?.position.x ?? 0) + 360, y: (writerNode?.position.y ?? 0) + 280 },
        agentId: "reviewer",
        task: "Check each claim in the brief against its source before Chief reads it.",
      });
      if (writerNode) state.edges.push({ id: nextId("edge"), from: writerNode.id, to: id });
    });
  };

  return (
    <DiagramView
      diagram={diagram}
      agents={agents}
      editable={props.editable}
      assistant={
        props.assistant === false
          ? undefined
          : {
              agent: chief,
              messages: chat.messages,
              working: chat.working,
              onSend: (text) => {
                setChat((state) => {
                  state.messages.push({ id: nextId("m"), author: "user", text, createdAt: new Date().toISOString() });
                  state.working = true;
                });
                later(1600, () => {
                  addAgentAfterLast();
                  setChat((state) => {
                    state.working = false;
                    state.messages.push({
                      id: nextId("m"),
                      author: "agent",
                      text: "Reviewer now checks the brief. It runs after Writer.",
                      changes: ["Added Reviewer after Writer", "Connected Writer to Reviewer"],
                      createdAt: new Date().toISOString(),
                    });
                  });
                });
              },
            }
      }
      onMoveNode={(nodeId, position) =>
        setDiagram((state) => {
          const node = state.nodes.find((candidate) => candidate.id === nodeId);
          if (node) node.position = position;
        })
      }
      onConnect={(from, to) =>
        setDiagram((state) => {
          state.edges.push({ id: nextId("edge"), from, to });
        })
      }
      onRemoveEdge={(edgeId) =>
        setDiagram((state) => ({ ...state, edges: state.edges.filter((e) => e.id !== edgeId) }))
      }
      onRemoveNode={(nodeId) =>
        setDiagram((state) => ({
          ...state,
          nodes: state.nodes.filter((node) => node.id !== nodeId),
          edges: state.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
        }))
      }
      onRunRoutine={runNow}
      onAddRoutine={() =>
        setDiagram((state) => {
          state.nodes.push({
            kind: "routine",
            id: nextId("node-routine"),
            position: { x: 0, y: 440 + state.nodes.length * 8 },
            name: "Friday review",
            schedule: { kind: "weekly", weekday: 5, time: "16:00" },
            active: false,
            nextRunAt: null,
          });
        })
      }
      onAddAgent={() =>
        setDiagram((state) => {
          state.nodes.push({
            kind: "agent",
            id: nextId("node-agent"),
            position: { x: 336, y: 560 + state.nodes.length * 8 },
            agentId: "research",
            task: "Describe what this agent does with its input.",
          });
        })
      }
    />
  );
}

/* The sidebar beside the diagram, the way the app lays them out. */

const diagramSummaries: DiagramSummary[] = [
  {
    id: "diagram-morning",
    name: "Morning brief",
    agentIds: ["research", "sales", "writer", "chief"],
    routineNames: ["Morning brief"],
    lastRunStatus: "succeeded",
    lastRunAt: STARTED,
    updatedAt: STARTED,
  },
  {
    id: "diagram-leads",
    name: "Inbound leads",
    agentIds: ["sales", "research"],
    routineNames: ["Every 30 minutes"],
    lastRunStatus: "failed",
    lastRunAt: "2026-10-05T16:30:00.000Z",
    updatedAt: "2026-10-05T16:30:00.000Z",
  },
  {
    id: "diagram-weekly",
    name: "Weekly planning",
    agentIds: ["chief"],
    routineNames: [],
    lastRunStatus: null,
    lastRunAt: null,
    updatedAt: "2026-10-01T09:00:00.000Z",
  },
];

const storyChannels: ChannelSummary[] = [
  {
    id: "channel-leadership",
    name: "leadership",
    title: "Daily priorities",
    instructions: "",
    members: [{ agentId: "chief" }, { agentId: "research" }, { agentId: "sales" }],
    leadAgentId: "chief",
    archived: false,
    revision: 1,
    createdAt: "2026-09-01T09:00:00.000Z",
    unreadCount: 2,
    activeTasks: 0,
    lastMessage: { at: STARTED, text: "Priorities for today are posted.", authorName: "Chief" },
  },
  {
    id: "channel-launch",
    name: "canvas-launch",
    title: "",
    instructions: "",
    members: [{ agentId: "research" }, { agentId: "sales" }],
    leadAgentId: null,
    archived: false,
    revision: 1,
    createdAt: "2026-09-10T09:00:00.000Z",
    unreadCount: 0,
    activeTasks: 1,
    lastMessage: { at: "2026-10-05T15:00:00.000Z", text: "Draft of the launch note", authorName: "Research" },
  },
];

function sidebarArgs(): Parameters<typeof Sidebar>[0] {
  return {
    serverName: "Local",
    onOpenServerSettings: fn(),
    agents,
    activeAgentId: "chief",
    people: [],
    directThreads: [],
    activeDirectMemberId: null,
    agentStates: {},
    agentMoods: {},
    layout: defaultSidebarLayout(),
    collapsedSectionIds: [],
    onMutateLayout: fn(async () => undefined),
    onToggleSection: fn(),
    pinnedItems: [],
    peopleOrder: [],
    onPin: fn(),
    onUnpin: fn(),
    onReorderPinned: fn(),
    onReorderPeople: fn(),
    onSelectAgent: fn(),
    onSelectPerson: fn(),
    onCreateAgent: fn(),
    onEditAgent: fn(),
    onDeleteAgent: async () => undefined,
    compact: false,
    onExpand: fn(),
    onOpenMarketplace: fn(),
    channels: storyChannels,
    onSelectChannel: fn(),
    onCreateChannel: fn(),
    diagrams: diagramSummaries,
    onCreateDiagram: fn(),
  };
}

function SidebarWithViews(props: { initialView: SidebarView }) {
  const [view, setView] = createSignal<SidebarView>(untrack(() => props.initialView));
  const [activeDiagramId, setActiveDiagramId] = createSignal<string | null>("diagram-morning");
  return (
    <div style={{ width: "280px", height: "100vh" }}>
      <Sidebar
        {...sidebarArgs()}
        view={view()}
        onViewChange={setView}
        activeDiagramId={activeDiagramId()}
        onSelectDiagram={setActiveDiagramId}
      />
    </div>
  );
}

function WorkspaceStage() {
  const [view, setView] = createSignal<SidebarView>("diagrams");
  const [activeDiagramId, setActiveDiagramId] = createSignal<string | null>("diagram-morning");
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ width: "280px", "flex-shrink": "0" }}>
        <Sidebar
          {...sidebarArgs()}
          view={view()}
          onViewChange={setView}
          activeDiagramId={activeDiagramId()}
          onSelectDiagram={setActiveDiagramId}
        />
      </div>
      <InteractiveDiagram diagram={succeededDiagram} />
    </div>
  );
}

const meta = {
  title: "Diagrams/Diagram",
  render: () => <WorkspaceStage />,
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole surface: the sidebar on its Diagrams view and the diagram in the chat area. */
export const Workspace: Story = {};

export const LastRunSucceeded: Story = {
  render: () => <InteractiveDiagram diagram={succeededDiagram} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

export const LastRunFailed: Story = {
  render: () => <InteractiveDiagram diagram={failedDiagram} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

export const Running: Story = {
  render: () => <InteractiveDiagram diagram={runningDiagram} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

export const NoRunYet: Story = {
  render: () => <InteractiveDiagram diagram={newDiagram} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

export const Empty: Story = {
  render: () => <InteractiveDiagram diagram={emptyDiagram} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

/** A viewer who cannot edit: the ports and tools are off, and there is no assistant. */
export const ReadOnly: Story = {
  render: () => <InteractiveDiagram diagram={succeededDiagram} editable={false} assistant={false} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

export const SidebarAgentsView: Story = { render: () => <SidebarWithViews initialView="agents" /> };
export const SidebarChannelsView: Story = { render: () => <SidebarWithViews initialView="channels" /> };
export const SidebarDiagramsView: Story = { render: () => <SidebarWithViews initialView="diagrams" /> };
