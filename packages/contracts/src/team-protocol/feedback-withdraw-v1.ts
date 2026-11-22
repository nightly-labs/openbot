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

export function decodeFeedbackWithdrawResult(value: unknown): WithdrawFeedbackResult {
  const status = isDynamicRecord(value) && isString(value.status) ? value.status : undefined;
  const known = STATUSES.find((candidate) => candidate === status);
  if (!known) throw new Error("Invalid feedback withdraw result.");
  return { status: known };
}
