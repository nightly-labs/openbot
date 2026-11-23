import { isBoundedString } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const SIDE_QUESTION_CAPABILITY = "side-question-v1";
export const SIDE_QUESTION_THREADS_CAPABILITY = "side-question-threads-v1";

export const SIDE_QUESTION_ROUTES = {
  ask: "/v1/side-questions/ask",
} as const;

export const SIDE_QUESTION_TEXT_LIMIT = 100_000;
const EARLIER_ANSWER_LIMIT = 32_000;
const EARLIER_TURNS_LIMIT = 20;

export const SIDE_QUESTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    SIDE_QUESTION_ROUTES.ask,
    adminRoute(
      fields(
        {
          agentId: identifier,
          question: string(SIDE_QUESTION_TEXT_LIMIT),
          earlier: list(
            fields({ question: string(SIDE_QUESTION_TEXT_LIMIT), answer: string(EARLIER_ANSWER_LIMIT) }),
            EARLIER_TURNS_LIMIT,
          ),
        },
        { taskId: identifier },
      ),
      fields({ answer: string(SIDE_QUESTION_TEXT_LIMIT) }),
    ),
  ],
]);

export function decodeSideQuestionResponse(value: unknown): string {
  if (!isDynamicRecord(value) || !isBoundedString(value.answer, SIDE_QUESTION_TEXT_LIMIT))
    throw new Error("Invalid side question answer.");
  return value.answer;
}
