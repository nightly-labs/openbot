import type { Effect } from "effect";
import type { AgentClient, AgentProvider } from "../agent-client";
import { type AccountReadResult, decodeAccountReadResult } from "../protocol";
import type { ProviderClientOperationError } from "../provider-client-effects";
import { findProviderDriver } from "../provider-drivers";

/**
 * The wait for a provider request that does not declare a slow path. A provider that cannot answer
 * in this time keeps its error on the row, so the user can retry instead of waiting on a dead CLI.
 */
export const PROVIDER_FAST_TIMEOUT_MS = 5_000;

/** The one client call that an account read needs, so a test can supply it without a whole client. */
export interface ProviderRequestClient {
  readonly request: AgentClient["request"];
}

/**
 * `account/read` runs before the first model list, so a provider whose account read is slow on a
 * proxied or distant network gets the normal request timeout instead of the fast-fail one. Only a
 * driver that sets `slowAccount` takes this path; a provider without a driver falls back to the
 * fast timeout instead of throwing from a call that used to pass a literal.
 */
export function providerAccountReadTimeoutMs(provider: AgentProvider, requestTimeoutMs: number): number {
  return findProviderDriver(provider)?.slowAccount === true ? requestTimeoutMs : PROVIDER_FAST_TIMEOUT_MS;
}

/** Reads a provider account with the wait that provider declares for a start or a refresh. */
export function readProviderAccount(
  client: ProviderRequestClient,
  provider: AgentProvider,
  refreshToken: boolean,
  requestTimeoutMs: number,
): Effect.Effect<AccountReadResult, ProviderClientOperationError> {
  return client.request(
    "account/read",
    { refreshToken },
    decodeAccountReadResult,
    providerAccountReadTimeoutMs(provider, requestTimeoutMs),
  );
}
