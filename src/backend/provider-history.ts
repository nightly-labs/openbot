import type { Effect } from "effect";
import type { ThreadItem } from "./protocol";
import type { ProviderClientOperationError } from "./provider-client-effects";

export interface ProviderHistoryFragment {
  turnId: string;
  status?: string;
  startedAt?: number;
  itemOffset?: number;
  items: ThreadItem[];
  liveTurnId?: string;
  recordsOnly?: boolean;
  complete: boolean;
}

export interface ProviderHistoryRequest {
  threadId: string;
  cwd?: string;
  items: "none" | "full";
  providerOnly?: boolean;
  resumeKey?: string;
}

export type ProviderHistoryConsumer = (
  fragment: ProviderHistoryFragment,
) => Effect.Effect<boolean, ProviderClientOperationError>;

export type ReadProviderHistory = (
  request: ProviderHistoryRequest,
  consume: ProviderHistoryConsumer,
) => Effect.Effect<void, ProviderClientOperationError>;

export const PROVIDER_HISTORY_PAGE_SIZE = 50;
