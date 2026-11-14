// Frozen optional usage-credits-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member of a server reads
// whether each provider account of the host can keep working on credits when a plan window is spent,
// as Codex reports it for a ChatGPT sign-in. The released usage routes and the `usage-changed` event
// do not carry it. A member gets the provider's own sign-in (`default`) only, as the released usage
// route gives; an owner or admin also gets the accounts after it, as `provider-accounts-v1` gives
// their usage. An account whose provider sends no credit state is left out. Only the flag travels:
// no balance, no plan, and no credential. The host also sends `usage-credits-changed`, an event with no
// data, when the flag of an account changes, so the client reads the route again. A protocol 9
// capability only. Widening any of it needs a second capability string.

import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  list,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const USAGE_CREDITS_CAPABILITY = "usage-credits-v1";

export type UsageCreditsEvent = { type: "usage-credits-changed" };

/** The usage credits event in `value`, or null for any other event. */
export function usageCreditsEvent(value: unknown): UsageCreditsEvent | null {
  if (!isDynamicRecord(value) || value.type !== "usage-credits-changed") return null;
  return { type: "usage-credits-changed" };
}

export const USAGE_CREDITS_ROUTES = {
  list: "/v1/usage-credits/list",
} as const;

const PROVIDER_LIMIT = 64;
const ACCOUNTS_PER_PROVIDER = 10;
const ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

const accountId: AdminDecoder = (value) => {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new Error("Invalid provider account.");
  return value;
};

export const USAGE_CREDITS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    USAGE_CREDITS_ROUTES.list,
    adminRoute(
      empty,
      fields({
        accounts: list(
          fields({ provider: string(PROVIDER_LIMIT), accountId, available: boolean }),
          PROVIDER_LIMIT * ACCOUNTS_PER_PROVIDER,
        ),
      }),
    ),
  ],
]);
