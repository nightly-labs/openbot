/**
 * Diagrams: agents wired behind the routines that start them, on a canvas in the chat area, with
 * the last run beside it and an assistant that edits the diagram. The stories hold the diagram in
 * local state, so every edit on the canvas works; a run and the assistant are simulated on a timer.
 * The app logic and the runtime that executes a run are not wired yet.
 */

import type { ChannelSummary } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { DiagramView } from "@openbot/ui/features/diagrams/DiagramView";
import { diagramRoutineSteps } from "@openbot/ui/features/diagrams/diagram-graph";
import type {
  Diagram,
  DiagramChatMessage,
  DiagramNode,
  DiagramRoutineRun,
  DiagramRun,
  DiagramStepRun,
} from "@openbot/ui/features/diagrams/diagram-model";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import type { SidebarView } from "@openbot/ui/features/sidebar/sidebar-types";
import { createSignal, createStore, For, Match, onCleanup, Show, Switch, snapshot, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { CHANNEL_STORY_ROWS, ChannelStoryComposer, ChannelTranscript } from "./channel-story-support";
import { StoryAgentConversation } from "./conversation-story-support";
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

/** The stories show the week from this moment, so the strips do not move with the real date. */
const NOW = "2026-10-06T10:00:00.000Z";
const DAY = 24 * 60 * 60;

/** Weekdays at 07:00 Warsaw time, from Wednesday 7 October. */
const morningUpcoming = [1, 2, 3, 6, 7, 8].map((day) => at(day * DAY));
/** Every 4 hours from noon UTC today. */
const sweepUpcoming = Array.from({ length: 6 * 7 }, (_, index) => at(7 * 3600 + index * 4 * 3600));

/** Friday 9 October, 16:00 Warsaw time. */
const fridayUpcoming = [at(3 * DAY + 9 * 3600)];

/** The newest run starts `offset` seconds after the morning brief's last run; each older one, `every` before it. */
function pastRuns(
  prefix: string,
  everySeconds: number,
  statuses: DiagramRoutineRun["status"][],
  offset = 0,
): DiagramRoutineRun[] {
  return statuses.map((status, index) => ({
    id: `${prefix}-${index}`,
    kind: index === 3 ? "manual" : "scheduled",
    status,
    startedAt: at(offset - index * everySeconds),
    finishedAt: at(offset - index * everySeconds + 60 + index * 7),
  }));
}

/** Pipeline sweep last ran an hour before the morning brief; Friday review, last Friday. */
const SWEEP_OFFSET = -3600;
const FRIDAY_OFFSET = -4 * DAY + 9 * 3600;

const morningRoutine: DiagramNode = {
  kind: "routine",
  id: "node-routine",
  position: { x: 0, y: 40 },
  name: "Morning brief",
  instruction:
    "Collect what changed since yesterday in the market and in the sales pipeline, then turn it into today's priorities.",
  schedule: { kind: "weekdays", time: "07:00" },
  active: true,
  upcomingRuns: morningUpcoming,
  recentRuns: pastRuns("morning", DAY, [
    "succeeded",
    "succeeded",
    "failed",
    "succeeded",
    "succeeded",
    "succeeded",
    "cancelled",
    "succeeded",
  ]),
};

const nodes: DiagramNode[] = [
  morningRoutine,
  {
    kind: "routine",
    id: "node-sweep",
    position: { x: 0, y: 360 },
    name: "Pipeline sweep",
    instruction: "Check the CRM for deals that changed stage and flag the ones that stalled.",
    schedule: { kind: "interval", amount: 4, unit: "hours", anchorAt: "2026-10-01T00:00:00.000Z" },
    active: true,
    upcomingRuns: sweepUpcoming,
    recentRuns: pastRuns(
      "sweep",
      4 * 3600,
      ["failed", "succeeded", "succeeded", "succeeded", "failed", "succeeded"],
      SWEEP_OFFSET,
    ),
  },
  {
    kind: "routine",
    id: "node-friday",
    position: { x: 0, y: 680 },
    name: "Friday review",
    instruction: "Sum up the week in the pipeline: what closed, what slipped, and what needs a push next week.",
    schedule: { kind: "weekly", weekday: 5, time: "16:00" },
    active: true,
    upcomingRuns: fridayUpcoming,
    recentRuns: pastRuns("friday", 7 * DAY, ["succeeded", "succeeded", "succeeded"], FRIDAY_OFFSET),
  },
  {
    kind: "agent",
    id: "node-research",
    position: { x: 360, y: 0 },
    agentId: "research",
    task: "Collect the market and product news since yesterday, with a source for each item.",
  },
  {
    kind: "agent",
    id: "node-sales",
    position: { x: 360, y: 280 },
    agentId: "sales",
    task: "List the deals that changed stage since yesterday and the next step for each.",
  },
  {
    kind: "agent",
    id: "node-writer",
    position: { x: 720, y: 140 },
    agentId: "writer",
    task: "Write one brief from the research and the pipeline. Keep it under 200 words.",
  },
  {
    kind: "agent",
    id: "node-chief",
    position: { x: 1080, y: 140 },
    agentId: "chief",
    task: "Read the brief, decide the three priorities for today and post them to the team.",
  },
  {
    kind: "agent",
    id: "node-reviewer",
    position: { x: 720, y: 460 },
    agentId: "reviewer",
    task: "Check each claim in the brief against its source.",
  },
];

const edges = [
  { id: "edge-1", from: "node-routine", to: "node-research" },
  { id: "edge-2", from: "node-routine", to: "node-sales" },
  // Research hands its findings to Writer only in the morning brief; its headline check stops at it.
  { id: "edge-3", from: "node-research", to: "node-writer", routineId: "node-routine" },
  { id: "edge-4", from: "node-sales", to: "node-writer" },
  { id: "edge-5", from: "node-writer", to: "node-chief" },
  { id: "edge-6", from: "node-sweep", to: "node-sales" },
  { id: "edge-7", from: "node-friday", to: "node-sales" },
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

/** Sales Outbound's step failed in the last sweep, so nothing after it ran. */
const sweepRun: DiagramRun = {
  id: "run-sweep",
  routineNodeId: "node-sweep",
  kind: "scheduled",
  status: "failed",
  startedAt: at(SWEEP_OFFSET),
  finishedAt: at(SWEEP_OFFSET + 64),
  steps: [
    step(
      "node-sales",
      "failed",
      "Check the CRM for deals that changed stage and flag the ones that stalled.",
      null,
      SWEEP_OFFSET,
      SWEEP_OFFSET + 64,
      "The CRM connector is signed out. Reconnect it in Settings > Connectors.",
    ),
    step("node-writer", "skipped", null, null, null, null),
    step("node-chief", "skipped", null, null, null, null),
  ],
};

const fridaySales = `Week 40 in the pipeline:
- Closed: Tailspin ($48k), Litware ($12k).
- Slipped: Fabrikam, now 9 days without a reply.
- Needs a push: Contoso security review, due Wednesday.`;
const fridayWriter = `Week 40 review

Two deals closed for $60k. Fabrikam slipped and needs the champion called on Monday. Contoso waits on our security review.`;
const fridayChief = `Next week:
1. Close Contoso: security review out by Wednesday.
2. Recover Fabrikam: call on Monday.

Posted to #leadership.`;

const fridayRun: DiagramRun = {
  id: "run-friday",
  routineNodeId: "node-friday",
  kind: "scheduled",
  status: "succeeded",
  startedAt: at(FRIDAY_OFFSET),
  finishedAt: at(FRIDAY_OFFSET + 120),
  steps: [
    step(
      "node-sales",
      "succeeded",
      "Sum up the week in the pipeline: what closed, what slipped, and what needs a push next week.",
      fridaySales,
      FRIDAY_OFFSET,
      FRIDAY_OFFSET + 48,
    ),
    step(
      "node-writer",
      "succeeded",
      `From Sales Outbound:\n${fridaySales}`,
      fridayWriter,
      FRIDAY_OFFSET + 48,
      FRIDAY_OFFSET + 90,
    ),
    step(
      "node-chief",
      "succeeded",
      `From Writer:\n${fridayWriter}`,
      fridayChief,
      FRIDAY_OFFSET + 90,
      FRIDAY_OFFSET + 120,
    ),
  ],
};

const succeededDiagram: Diagram = {
  id: "diagram-morning",
  name: "Morning brief",
  nodes,
  edges,
  updatedAt: STARTED,
  lastRuns: [
    {
      id: "run-1",
      routineNodeId: "node-routine",
      kind: "scheduled",
      status: "succeeded",
      startedAt: STARTED,
      finishedAt: at(95),
      steps: succeededSteps(),
    },
    sweepRun,
    fridayRun,
  ],
};

const failedDiagram: Diagram = {
  ...succeededDiagram,
  lastRuns: [
    {
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
    sweepRun,
    fridayRun,
  ],
};

const runningDiagram: Diagram = {
  ...succeededDiagram,
  lastRuns: [
    {
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
    sweepRun,
    fridayRun,
  ],
};

const newDiagram: Diagram = { ...succeededDiagram, id: "diagram-new", lastRuns: [] };
const emptyDiagram: Diagram = {
  ...succeededDiagram,
  id: "diagram-empty",
  name: "Untitled diagram",
  nodes: [],
  edges: [],
  lastRuns: [],
};

/**
 * The simplest diagram: one routine, one agent, nothing after it. The agent checks a page on a timer
 * and writes a report only when something changed, so most runs end with "No change".
 */
const HEADLINE = "Senate passes the infrastructure bill after a late-night vote";
const headlineDiagram: Diagram = {
  id: "diagram-headline",
  name: "NYT headline check",
  updatedAt: STARTED,
  nodes: [
    {
      kind: "routine",
      id: "node-headline-check",
      position: { x: 0, y: 0 },
      name: "NYT headline check",
      instruction: "Open nytimes.com and read the top headline. Report it only when it changed since the last check.",
      schedule: { kind: "interval", amount: 30, unit: "minutes", anchorAt: "2026-10-01T00:00:00.000Z" },
      active: true,
      upcomingRuns: Array.from({ length: 48 * 7 }, (_, index) => at(5 * 3600 + 1800 + index * 1800)),
      recentRuns: pastRuns("headline", 1800, [
        "succeeded",
        "succeeded",
        "succeeded",
        "succeeded",
        "failed",
        "succeeded",
      ]),
    },
    {
      kind: "agent",
      id: "node-headline-agent",
      position: { x: 360, y: 0 },
      agentId: "research",
      task: "Compare the top headline with the one you saw last time. Write a short report only when it changed.",
    },
  ],
  edges: [{ id: "edge-headline", from: "node-headline-check", to: "node-headline-agent" }],
  lastRuns: [
    {
      id: "run-headline",
      routineNodeId: "node-headline-check",
      kind: "scheduled",
      status: "succeeded",
      startedAt: STARTED,
      finishedAt: at(18),
      steps: [
        step(
          "node-headline-agent",
          "succeeded",
          "Open nytimes.com and read the top headline. Report it only when it changed since the last check.",
          `No change. The top headline is still: "${HEADLINE}".`,
          0,
          18,
        ),
      ],
    },
  ],
};

/** One routine that a webhook starts instead of a schedule: a published release, for one agent. */
const webhookDiagram: Diagram = {
  id: "diagram-webhook",
  name: "Release published",
  updatedAt: STARTED,
  nodes: [
    {
      kind: "routine",
      id: "node-release-published",
      position: { x: 0, y: 0 },
      name: "Release published",
      instruction: "Check the published release's notes and assets, then list the three things the team does next.",
      schedule: null,
      webhook: {
        url: "https://relay.openbot.example/v1/webhooks/2e2faecf-ce55-4bb5-9d70-04ff5e40a1fc",
        eventType: "release.published",
        filters: [{ pointer: "/release/prerelease", value: false }],
      },
      active: true,
      upcomingRuns: [],
      recentRuns: pastRuns("release", 6 * 3600, ["succeeded", "succeeded", "failed", "succeeded"]),
    },
    {
      kind: "agent",
      id: "node-release-agent",
      position: { x: 360, y: 0 },
      agentId: "research",
      task: "Read the release notes and the asset list, and name what the team does next.",
    },
  ],
  edges: [{ id: "edge-release", from: "node-release-published", to: "node-release-agent" }],
  lastRuns: [
    {
      id: "run-release",
      routineNodeId: "node-release-published",
      kind: "scheduled",
      status: "succeeded",
      startedAt: STARTED,
      finishedAt: at(24),
      steps: [
        step(
          "node-release-agent",
          "succeeded",
          "Check the published release's notes and assets, then list the three things the team does next.",
          "1. Announce v0.33.0 in the community channel. 2. Update the docs site. 3. Close the release milestone.",
          0,
          24,
        ),
      ],
    },
  ],
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
function InteractiveDiagram(props: {
  diagram: Diagram;
  owner?: AgentProfile | undefined;
  assistant?: boolean;
  editable?: boolean;
}) {
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
    // The routine's own path, in step order: each step starts once the one before it is done.
    const order = [...diagramRoutineSteps(snapshot(diagram.edges), routineNodeId).entries()].sort(
      (left, right) => left[1] - right[1],
    );
    const done = new Map(succeededSteps().map((entry) => [entry.nodeId, entry]));
    const startedAt = new Date().toISOString();
    const runId = nextId("run");
    const routineRuns = (state: Diagram) => {
      const routine = state.nodes.find((node) => node.id === routineNodeId);
      return routine?.kind === "routine" ? routine.recentRuns : [];
    };
    const currentRun = (state: Diagram) => state.lastRuns.find((run) => run.id === runId);
    setDiagram((state) => {
      routineRuns(state).unshift({ id: runId, kind: "manual", status: "running", startedAt, finishedAt: null });
      state.lastRuns = [
        ...state.lastRuns.filter((run) => run.routineNodeId !== routineNodeId),
        {
          id: runId,
          routineNodeId,
          kind: "manual",
          status: "running",
          startedAt,
          finishedAt: null,
          steps: order.map(([nodeId]) => step(nodeId, "waiting", null, null, null, null)),
        },
      ];
    });
    const levels = [...new Set(order.map(([, level]) => level))];
    levels.forEach((level, index) => {
      const ids = order.filter(([, value]) => value === level).map(([nodeId]) => nodeId);
      later(index * 1400 + 200, () =>
        setDiagram((state) => {
          for (const entry of currentRun(state)?.steps ?? []) {
            if (!ids.includes(entry.nodeId)) continue;
            entry.status = "running";
            entry.input = done.get(entry.nodeId)?.input ?? "Started by hand.";
            entry.startedAt = new Date().toISOString();
          }
        }),
      );
      later(index * 1400 + 1400, () =>
        setDiagram((state) => {
          const run = currentRun(state);
          for (const entry of run?.steps ?? []) {
            if (!ids.includes(entry.nodeId)) continue;
            entry.status = "succeeded";
            entry.output = done.get(entry.nodeId)?.output ?? "Done.";
            entry.finishedAt = new Date().toISOString();
          }
          if (index === levels.length - 1 && run) {
            const finishedAt = new Date().toISOString();
            run.status = "succeeded";
            run.finishedAt = finishedAt;
            const entry = routineRuns(state).find((past) => past.id === runId);
            if (entry) {
              entry.status = "succeeded";
              entry.finishedAt = finishedAt;
            }
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
      owner={props.owner}
      now={NOW}
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
      onConnect={(from, to) => {
        setDiagram((state) => {
          state.edges.push({ id: nextId("edge"), from, to });
        });
        return true;
      }}
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
      webhooks={{
        connected: true,
        onSave: async (routineNodeId, change) => {
          setDiagram((state) => {
            const node = state.nodes.find((candidate) => candidate.id === routineNodeId);
            if (node?.kind === "routine" && node.webhook) node.webhook = { ...node.webhook, ...change };
          });
        },
        onRegenerateSecret: async () => `whsec_story_${nextId("secret")}`,
      }}
    />
  );
}

/* The app's layout: the sidebar, and the open chat or its routines beside it. */

/**
 * Every routine in the workspace on one canvas, the headline check included. Research is one node
 * here, so its morning brief and its headline check meet on the same card.
 */
const headlineRoutine = headlineDiagram.nodes[0];
const workspacePool: Diagram = {
  ...succeededDiagram,
  nodes: [...succeededDiagram.nodes, ...(headlineRoutine ? [{ ...headlineRoutine, position: { x: 0, y: -320 } }] : [])],
  edges: [
    ...succeededDiagram.edges,
    {
      id: "edge-headline-research",
      from: "node-headline-check",
      to: "node-research",
      routineId: "node-headline-check",
    },
  ],
  lastRuns: [
    ...succeededDiagram.lastRuns,
    ...headlineDiagram.lastRuns.map((run) => ({
      ...run,
      steps: run.steps.map((entry) => ({ ...entry, nodeId: "node-research" })),
    })),
  ],
};

/**
 * One agent's canvas: every routine whose run reaches it, and every node those runs reach. An agent
 * without routines still stands on its canvas, ready to be connected to one.
 */
function agentDiagram(agent: AgentProfile): Diagram {
  const pool = workspacePool;
  const own = pool.nodes.filter((node) => node.kind === "agent" && node.agentId === agent.id).map((node) => node.id);
  const routines = pool.nodes.filter(
    (node) => node.kind === "routine" && own.some((id) => diagramRoutineSteps(pool.edges, node.id).has(id)),
  );
  const routineIds = new Set(routines.map((node) => node.id));
  const keep = new Set<string>(routineIds);
  for (const routine of routines) for (const id of diagramRoutineSteps(pool.edges, routine.id).keys()) keep.add(id);
  const nodes = pool.nodes.filter((node) => keep.has(node.id));
  return {
    id: `agent-${agent.id}`,
    name: agent.name,
    nodes:
      nodes.length > 0
        ? nodes
        : [{ kind: "agent", id: `node-${agent.id}`, position: { x: 360, y: 0 }, agentId: agent.id, task: "" }],
    edges: pool.edges.filter(
      (edge) =>
        keep.has(edge.from) && keep.has(edge.to) && (edge.routineId === undefined || routineIds.has(edge.routineId)),
    ),
    lastRuns: pool.lastRuns.filter((run) => routineIds.has(run.routineNodeId)),
    updatedAt: pool.updatedAt,
  };
}

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
  };
}

function SidebarWithViews(props: { initialView: SidebarView }) {
  const [view, setView] = createSignal<SidebarView>(untrack(() => props.initialView));
  return (
    <div style={{ width: "280px", height: "100vh" }}>
      <Sidebar {...sidebarArgs()} view={view()} onViewChange={setView} />
    </div>
  );
}

/**
 * The sidebar is the same chat list in both views. On Agents the main area shows the open chat, as
 * it always has; on Routines it shows the open agent's canvas: all its routines, with tabs to pick one.
 */
function WorkspaceStage() {
  const [view, setView] = createSignal<SidebarView>("routines");
  const [chat, setChat] = createSignal<{ kind: "agent" | "channel"; id: string }>({ kind: "agent", id: "sales" });
  const openAgent = () => (chat().kind === "agent" ? agents.find((agent) => agent.id === chat().id) : undefined);
  const openChannel = () =>
    chat().kind === "channel" ? storyChannels.find((channel) => channel.id === chat().id) : undefined;
  // A one-item list keyed by the open chat, so another chat's routines start from their first.
  const routinesKey = () => (view() === "routines" ? [`${chat().kind}:${chat().id}`] : []);
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ width: "280px", "flex-shrink": "0" }}>
        <Sidebar
          {...sidebarArgs()}
          view={view()}
          onViewChange={setView}
          activeAgentId={openAgent()?.id ?? ""}
          onSelectAgent={(id) => setChat({ kind: "agent", id })}
          activeChannelId={openChannel()?.id ?? null}
          onSelectChannel={(id) => setChat({ kind: "channel", id })}
        />
      </div>
      <div style={{ display: "flex", flex: "1", "min-width": "0" }}>
        <Switch>
          <Match when={view() === "routines"}>
            <For each={routinesKey()}>
              {() => (
                <Show
                  when={openAgent()}
                  fallback={<InteractiveDiagram diagram={{ ...emptyDiagram, name: openChannel()?.name ?? "" }} />}
                >
                  {(agent) => <InteractiveDiagram diagram={agentDiagram(agent())} owner={agent()} />}
                </Show>
              )}
            </For>
          </Match>
          <Match when={openChannel()}>
            {(channel) => (
              <div class="conversation-story-frame">
                <ChannelTranscript rows={CHANNEL_STORY_ROWS} workers={[]}>
                  <ChannelStoryComposer channelName={channel().name} />
                </ChannelTranscript>
              </div>
            )}
          </Match>
          <Match when={openAgent()}>{(agent) => <StoryAgentConversation agent={agent()} />}</Match>
        </Switch>
      </div>
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

/**
 * The whole surface. On the Agents view the middle shows the open agent or channel chat; on the
 * Routines view it shows the open agent's routines on one canvas, with tabs to pick one.
 */
export const Workspace: Story = {};

/** Sales Outbound is started by three routines; the tabs over its canvas pick one. */
export const AgentWithSeveralRoutines: Story = {
  render: () => <InteractiveDiagram diagram={agentDiagram(sales)} owner={sales} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

/** Research has the morning brief, and a headline check it runs alone. */
export const AgentWithSimpleRoutine: Story = {
  render: () => <InteractiveDiagram diagram={agentDiagram(research)} owner={research} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

export const AgentWithoutRoutines: Story = {
  render: () => <InteractiveDiagram diagram={agentDiagram(reviewer)} owner={reviewer} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

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

/** One routine and one agent that works alone: a page check every 30 minutes. */
export const SingleAgentRoutine: Story = {
  render: () => <InteractiveDiagram diagram={headlineDiagram} />,
  decorators: [(Story) => <div style={{ display: "flex", height: "100vh" }}>{Story()}</div>],
};

/** A routine that a webhook starts: its card says which events start it, and its details set the webhook. */
export const WebhookRoutine: Story = {
  render: () => <InteractiveDiagram diagram={webhookDiagram} />,
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
export const SidebarRoutinesView: Story = { render: () => <SidebarWithViews initialView="routines" /> };
