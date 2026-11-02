// Frozen optional side-question-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any member of a server can
// ask a question about the chat of one agent of the host that the member can see. The host answers
// with the agent's own provider and model, from the agent's profile and the end of its chat, with no
// tools. The question and the answer do not go into the chat, and the host keeps nothing of them, so
// the request carries the earlier questions and answers of the side question. At most 20 earlier
// turns cross in one request. A question and an answer have at most 100,000 characters, and an earlier
// answer at most 32,000. Widening any of it needs a second capability string.
import { isBoundedString } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const SIDE_QUESTION_CAPABILITY = "side-question-v1";

export const SIDE_QUESTION_ROUTES = {
  ask: "/v1/side-questions/ask",
} as const;

/** The longest question and answer that cross the wire. */
export const SIDE_QUESTION_TEXT_LIMIT = 100_000;
/** The longest earlier answer: a client sends back only the start of a longer one. */
const EARLIER_ANSWER_LIMIT = 32_000;
const EARLIER_TURNS_LIMIT = 20;

export const SIDE_QUESTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    SIDE_QUESTION_ROUTES.ask,
    adminRoute(
      fields({
        agentId: identifier,
        question: string(SIDE_QUESTION_TEXT_LIMIT),
        earlier: list(
          fields({ question: string(SIDE_QUESTION_TEXT_LIMIT), answer: string(EARLIER_ANSWER_LIMIT) }),
          EARLIER_TURNS_LIMIT,
        ),
      }),
      fields({ answer: string(SIDE_QUESTION_TEXT_LIMIT) }),
    ),
  ],
]);

/**
 * The answer a host sends, as the client type. The transport has already run the response through
 * the codec above; this gives it the type that the client reads.
 */
export function decodeSideQuestionResponse(value: unknown): string {
  if (!isDynamicRecord(value) || !isBoundedString(value.answer, SIDE_QUESTION_TEXT_LIMIT))
    throw new Error("Invalid side question answer.");
  return value.answer;
}
