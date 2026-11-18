// The layout and the hover timing of the workflow picture. No JSX here, for the same reason
// `landing-content.ts` holds none.

import { LANDING_WORKFLOW_AGENTS, LANDING_WORKFLOW_EDGES, type LandingWorkflowStepId } from "./landing-content";

/** How long a line takes to reach the next step, in milliseconds. */
export const LANDING_WORKFLOW_EDGE_MS = 240;

/** The trigger fires quickly. The approval waits a moment for the person who clicks. */
const TRIGGER_MS = 300;
const APPROVAL_MS = 640;

/**
 * The width of one column and of the gap between columns, in percent of the picture. The
 * stylesheet uses the same gap, so the lines meet the cards.
 */
const COLUMN = 19;
const GAP = 8;

interface WorkflowPlace {
  /** 0 to 3, from the trigger to the approval. */
  column: number;
  /** 0 or 1 for a step that runs next to another one, null for a step alone in its column. */
  lane: 0 | 1 | null;
}

function workflowPlace(id: LandingWorkflowStepId): WorkflowPlace {
  if (id === "trigger") return { column: 0, lane: null };
  if (id === "approval") return { column: 3, lane: null };
  const agent = LANDING_WORKFLOW_AGENTS.find((step) => step.id === id);
  return { column: agent?.column ?? 1, lane: agent?.lane ?? null };
}

/** The middle of a lane across the picture, in percent: lanes at a quarter and at three quarters. */
const laneMiddle = (lane: 0 | 1 | null) => (lane === null ? 50 : 25 + lane * 50);

/** When each step starts and how long it runs: a step starts when every step before it is done. */
export interface WorkflowTiming {
  startMs: number;
  runMs: number;
}

function workflowSchedule(): ReadonlyMap<LandingWorkflowStepId, WorkflowTiming> {
  const steps: readonly { id: LandingWorkflowStepId; runMs: number }[] = [
    { id: "trigger", runMs: TRIGGER_MS },
    ...LANDING_WORKFLOW_AGENTS,
    { id: "approval", runMs: APPROVAL_MS },
  ];
  const schedule = new Map<LandingWorkflowStepId, WorkflowTiming>();
  for (const step of steps) {
    const ready = LANDING_WORKFLOW_EDGES.filter(([, to]) => to === step.id).map(([from]) => {
      const before = schedule.get(from);
      return before ? before.startMs + before.runMs + LANDING_WORKFLOW_EDGE_MS : 0;
    });
    schedule.set(step.id, { startMs: Math.max(0, ...ready), runMs: step.runMs });
  }
  return schedule;
}

const SCHEDULE = workflowSchedule();

export function workflowTiming(id: LandingWorkflowStepId): WorkflowTiming {
  return SCHEDULE.get(id) ?? { startMs: 0, runMs: 0 };
}

export interface WorkflowEdge {
  key: string;
  /** The line leaves when the step before it is done. */
  startMs: number;
  /** From the right side of a card to the left side of the next one, with the columns side by side. */
  wide: string;
  /** From the middle of a card to the middle of the next one, with the columns one under the other. */
  tall: string;
}

const round = (value: number) => Math.round(value * 100) / 100;

function edgePath(from: LandingWorkflowStepId, to: LandingWorkflowStepId): WorkflowEdge {
  const source = workflowPlace(from);
  const target = workflowPlace(to);
  const x1 = source.column * (COLUMN + GAP) + COLUMN;
  const x2 = target.column * (COLUMN + GAP);
  const y1 = laneMiddle(source.lane);
  const y2 = laneMiddle(target.lane);
  const middleX = round((x1 + x2) / 2);
  // With the columns one under the other, each column is a row of a quarter of the height.
  const top = (source.column + 0.5) * 25;
  const bottom = (target.column + 0.5) * 25;
  const middleY = round((top + bottom) / 2);
  const before = workflowTiming(from);
  return {
    key: `${from}-${to}`,
    startMs: before.startMs + before.runMs,
    wide: `M${x1} ${y1}C${middleX} ${y1} ${middleX} ${y2} ${x2} ${y2}`,
    tall: `M${y1} ${top}C${y1} ${middleY} ${y2} ${middleY} ${y2} ${bottom}`,
  };
}

export const LANDING_WORKFLOW_PATHS: readonly WorkflowEdge[] = LANDING_WORKFLOW_EDGES.map(([from, to]) =>
  edgePath(from, to),
);
