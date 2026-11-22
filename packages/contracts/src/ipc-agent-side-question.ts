import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export interface SideQuestionTurn {
  question: string;
  answer: string;
}

export interface AskSideQuestionInput {
  agentId: string;
  question: string;
  earlier: SideQuestionTurn[];
  taskId?: string;
}

function isSideQuestionTurn(value: unknown): value is SideQuestionTurn {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.question, INPUT_LIMITS.messageText) &&
    isBoundedString(value.answer, INPUT_LIMITS.sideQuestionAnswer)
  );
}

export function parseAskSideQuestion(value: unknown): AskSideQuestionInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !isBoundedString(value.question, INPUT_LIMITS.messageText) ||
    !value.question.trim() ||
    !Array.isArray(value.earlier) ||
    value.earlier.length > INPUT_LIMITS.sideQuestionTurns ||
    !value.earlier.every(isSideQuestionTurn) ||
    (value.taskId !== undefined && !isIdentifier(value.taskId))
  ) {
    throw new Error("Provide a valid side question.");
  }
  return {
    agentId: value.agentId,
    question: value.question.trim(),
    earlier: value.earlier.map((turn) => ({ question: turn.question, answer: turn.answer })),
    ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
  };
}
