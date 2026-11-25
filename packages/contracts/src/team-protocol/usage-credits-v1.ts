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
