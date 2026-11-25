import { agentStepActivity } from "@openbot/contracts/ipc";
import type { WorkflowAgentProgress } from "@openbot/ui/features/workflows/workflow-board";
import type { TurnStepLines } from "../conversation/turn-step-lines";

interface TurnProgress {
  turnId: string;
  detail: string;
  running?: boolean;
  activity?: string;
}

export function workflowAgentProgress(
  agentId: string,
  progress: TurnProgress | undefined,
  lines: TurnStepLines,
): WorkflowAgentProgress | undefined {
  if (!progress?.detail.trim()) return undefined;
  const turn = lines[progress.turnId] ?? [];
  const current = turn.at(-1)?.text === progress.detail ? turn.length - 1 : turn.length;
  return {
    agentId,
    detail: progress.detail,
    previous: turn
      .slice(0, current)
      .reverse()
      .find((line) => line.text !== progress.detail)?.text,
    activity: agentStepActivity(progress.activity),
    done: progress.running ? current : turn.length,
  };
}
