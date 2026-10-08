import type { Effect } from "effect";
import type { ThreadItem } from "./protocol";
import type { ProviderClientOperationError } from "./provider-client-effects";

/** A fragment is never a complete conversation or a replacement snapshot. */
export interface ProviderHistoryFragment {
  turnId: string;
  status?: string;
  startedAt?: number;
  /** Stable offset within the turn. This is not a provider cursor. */
  itemOffset?: number;
  items: ThreadItem[];
  /** The provider has no stable OpenBot turn identity; retain this record for reads and recovery only. */
  recordsOnly?: boolean;
  /** The last fragment of this turn in this scan. */
  complete: boolean;
}

export interface ProviderHistoryRequest {
  threadId: string;
  cwd?: string;
  /** Metadata reads omit items, for recovery of a known turn. */
  items: "none" | "full";
  /** Import recovery from the provider; do not satisfy this read from the durable staging seam. */
  providerOnly?: boolean;
}

/** Return false to stop the scan after this fragment. Cursors stay inside the adapter. */
export type ProviderHistoryConsumer = (
  fragment: ProviderHistoryFragment,
) => Effect.Effect<boolean, ProviderClientOperationError>;

export type ReadProviderHistory = (
  request: ProviderHistoryRequest,
  consume: ProviderHistoryConsumer,
) => Effect.Effect<void, ProviderClientOperationError>;

export const PROVIDER_HISTORY_PAGE_SIZE = 50;
