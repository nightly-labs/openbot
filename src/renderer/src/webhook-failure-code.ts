import { matchingSourceKeys } from "@openbot/i18n";
import { normalizeMessage } from "@openbot/user-errors/reference";

/**
 * The `failure_code` of a failed routine or workflow action: `webhook_route_limit` when the host
 * refused a webhook address because it has the most it can have, else `fallback`. The limit is a
 * product limit, so it is counted apart from faults. `scripts/webhook-analytics-e2e.ts` checks it
 * with the error text that the host sends.
 */
export function webhookFailureCode(error: unknown, fallback: string): string {
  return matchingSourceKeys(normalizeMessage(error))[0] === "error.backend.webhookRouteLimit"
    ? "webhook_route_limit"
    : fallback;
}
