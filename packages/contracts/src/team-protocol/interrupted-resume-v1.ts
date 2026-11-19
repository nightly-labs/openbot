// Frozen optional interrupted-resume-v1 wire contract.
//
// Lets a joined client read which visible agents stopped in an interrupted turn (including turns
// recovered after a host restart), continue one or all of them, or dismiss the interrupted badge.

import { INPUT_LIMITS } from "../input-limits";
import { isIdentifier } from "../ipc-bounded-values";
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, fields, identifier, list, type OptionalRouteCodec } from "./admin-wire";

export const INTERRUPTED_RESUME_CAPABILITY = "interrupted-resume-v1";

export const INTERRUPTED_RESUME_ROUTES = {
  list: "/v1/interrupted-turns/list",
  continue: "/v1/interrupted-turns/continue",
  dismiss: "/v1/interrupted-turns/dismiss",
} as const;

export const INTERRUPTED_RESUME_LIST_LIMIT = INPUT_LIMITS.agents;

const interruptedTurn = fields({
  agentId: identifier,
  turnId: identifier,
});

const emptyRequest: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).length > 0) {
    throw new Error("Invalid interrupted turns request.");
  }
  return {};
};

const continueRequest = fields({
  agentIds: list(identifier, INTERRUPTED_RESUME_LIST_LIMIT),
});

const dismissRequest = fields({
  agentId: identifier,
  turnId: identifier,
});

export const INTERRUPTED_RESUME_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    INTERRUPTED_RESUME_ROUTES.list,
    adminRoute(emptyRequest, fields({ interruptedTurns: list(interruptedTurn, INTERRUPTED_RESUME_LIST_LIMIT) })),
  ],
  [
    INTERRUPTED_RESUME_ROUTES.continue,
    adminRoute(continueRequest, fields({ continued: list(identifier, INTERRUPTED_RESUME_LIST_LIMIT) })),
  ],
  [INTERRUPTED_RESUME_ROUTES.dismiss, adminRoute(dismissRequest, fields({}))],
]);

export interface InterruptedTurnsList {
  interruptedTurns: Array<{ agentId: string; turnId: string }>;
}

export function isInterruptedTurnsList(value: unknown): value is InterruptedTurnsList {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.interruptedTurns) &&
    value.interruptedTurns.length <= INTERRUPTED_RESUME_LIST_LIMIT &&
    value.interruptedTurns.every(
      (entry) => isDynamicRecord(entry) && isIdentifier(entry.agentId) && isIdentifier(entry.turnId),
    )
  );
}

export function isContinueInterruptedResult(value: unknown): value is { continued: string[] } {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.continued) &&
    value.continued.length <= INTERRUPTED_RESUME_LIST_LIMIT &&
    value.continued.every(isIdentifier)
  );
}
