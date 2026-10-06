import type { AppMessages } from "@openbot/i18n";
import type { DiagramRunStatus, DiagramStepRun, DiagramStepStatus } from "./diagram-model";

export const DIAGRAM_STEP_STATUS_KEY = {
  waiting: "diagram.step.waiting",
  running: "diagram.step.running",
  succeeded: "diagram.step.succeeded",
  failed: "diagram.step.failed",
  skipped: "diagram.step.skipped",
} as const satisfies Record<DiagramStepStatus, keyof AppMessages>;

export const DIAGRAM_RUN_STATUS_KEY = {
  running: "diagram.run.running",
  succeeded: "diagram.run.succeeded",
  failed: "diagram.run.failed",
  cancelled: "diagram.run.cancelled",
} as const satisfies Record<DiagramRunStatus, keyof AppMessages>;

/** Whole seconds a finished step took, or null while it has not finished. */
export function diagramStepSeconds(step: DiagramStepRun): number | null {
  if (!step.startedAt || !step.finishedAt) return null;
  return Math.max(0, Math.round((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000));
}
