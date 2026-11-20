import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { EventFilter } from "@openbot/contracts/ipc-events";

export interface DiagramRoutineWebhook {
  url: string | null;
  eventType: string | null;
  filters: EventFilter[];
}

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
      instruction: string;
      schedule: RoutineSchedule | null;
      webhook?: DiagramRoutineWebhook | undefined;
      active: boolean;
      upcomingRuns: string[];
      recentRuns: DiagramRoutineRun[];
    }
  | {
      kind: "agent";
      id: string;
      position: DiagramPoint;
      agentId: string;
      task: string;
      tasks?: Record<string, string>;
    };

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  routineId?: string;
}

export type DiagramStepStatus = "waiting" | "running" | "succeeded" | "failed" | "skipped";
export type DiagramRunStatus = "running" | "succeeded" | "failed" | "cancelled";

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
  routineNodeId: string;
  kind: "scheduled" | "manual";
  status: DiagramRunStatus;
  startedAt: string;
  finishedAt: string | null;
  steps: DiagramStepRun[];
}

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
  lastRuns: DiagramRun[];
  updatedAt: string;
}

export interface DiagramChatMessage {
  id: string;
  author: "user" | "agent";
  text: string;
  changes?: string[];
  createdAt: string;
}
