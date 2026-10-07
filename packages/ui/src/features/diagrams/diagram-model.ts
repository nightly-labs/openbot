/**
 * What a diagram is, as the canvas draws it. A diagram files agents behind the routines that start
 * them: a routine node fires, each agent node takes the outputs of the nodes that point at it as its
 * input, and its own output goes to every node it points at. These are display types; the stored
 * shape and the runtime that executes a run belong to the app and are not decided here.
 */

import type { RoutineSchedule } from "@openbot/contracts/ipc";

export interface DiagramPoint {
  x: number;
  y: number;
}

export type DiagramNode =
  | {
      kind: "routine";
      id: string;
      position: DiagramPoint;
      name: string;
      /** What the routine asks for. The agents it starts receive it as their input. */
      instruction: string;
      schedule: RoutineSchedule;
      active: boolean;
      /**
       * The times it fires next, soonest first. The host expands the schedule, so the canvas never
       * reads a cron expression. Empty while the routine is paused.
       */
      upcomingRuns: string[];
      /** Its last runs, newest first. */
      recentRuns: DiagramRoutineRun[];
    }
  | {
      kind: "agent";
      id: string;
      position: DiagramPoint;
      agentId: string;
      /** What this agent does with its input. */
      task: string;
    };

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
}

export type DiagramStepStatus = "waiting" | "running" | "succeeded" | "failed" | "skipped";
export type DiagramRunStatus = "running" | "succeeded" | "failed" | "cancelled";

/** One node's part of a run: what it received, what it returned, and when. */
export interface DiagramStepRun {
  nodeId: string;
  status: DiagramStepStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DiagramRun {
  id: string;
  /** The routine node that fired the run. */
  routineNodeId: string;
  kind: "scheduled" | "manual";
  status: DiagramRunStatus;
  startedAt: string;
  finishedAt: string | null;
  steps: DiagramStepRun[];
}

/** One past run of a routine, for its history. Only the last run of the diagram has step details. */
export interface DiagramRoutineRun {
  id: string;
  kind: "scheduled" | "manual";
  status: DiagramRunStatus;
  startedAt: string;
  finishedAt: string | null;
}

export interface Diagram {
  id: string;
  name: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /**
   * The last run of each routine, at most one per routine node. An agent that several routines
   * start keeps what it received and returned in each of them.
   */
  lastRuns: DiagramRun[];
  updatedAt: string;
}

/** One message in the panel where an agent edits the diagram for the user. */
export interface DiagramChatMessage {
  id: string;
  author: "user" | "agent";
  text: string;
  /** The edits an agent message made to the diagram, one line each. */
  changes?: string[];
  createdAt: string;
}
