// Frozen optional feedback-withdraw-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can chat with an
// agent can press Remove on a thank-you card of a feedback report in that agent's own chat (`withdraw`).
// The host takes the report off GitHub with its own OpenBot account, the account that sent it, and the
// card in the chat changes to a removed card for every member. The request names the agent and the
// card message only; the host reads the card, and the issue number on it, itself. The response is the
// result: `withdrawn` (also for a card that was removed before), `signedOut` (the host is not signed
// in to OpenBot), `notYours` (another account sent the report, or it was sent before reports could be
// removed), `unavailable` (the account service cannot remove an issue now), `limited` (too many tries),
// `notFound` (the message is not a thank-you card of this host) or `moved` (the issue moved to another
// public repository). The host answers 404 for an agent hidden from the caller, and 403 below chat
// access. A protocol 9 capability only. Widening any of it needs a second capability string.
import type { WithdrawFeedbackResult } from "../ipc-conversations";
import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, fields, identifier, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const FEEDBACK_WITHDRAW_CAPABILITY = "feedback-withdraw-v1";

export const FEEDBACK_WITHDRAW_ROUTES = {
  withdraw: "/v1/feedback/withdraw",
} as const;

const STATUSES = ["withdrawn", "signedOut", "notYours", "unavailable", "limited", "notFound", "moved"] as const;

export const FEEDBACK_WITHDRAW_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    FEEDBACK_WITHDRAW_ROUTES.withdraw,
    adminRoute(fields({ agentId: identifier, messageId: identifier }), fields({ status: oneOf(...STATUSES) })),
  ],
]);

/** The result of a `withdraw` response, after the wire codec checked it. */
export function decodeFeedbackWithdrawResult(value: unknown): WithdrawFeedbackResult {
  const status = isDynamicRecord(value) && isString(value.status) ? value.status : undefined;
  const known = STATUSES.find((candidate) => candidate === status);
  if (!known) throw new Error("Invalid feedback withdraw result.");
  return { status: known };
}
