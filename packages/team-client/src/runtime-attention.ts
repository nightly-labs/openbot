/**
 * Folds the pending requests of a runtime snapshot into the list a client shows.
 *
 * The host cuts a snapshot's attention lists when it holds more requests than the snapshot limit
 * or the snapshot is too large, and then sends `attentionComplete: false`. A complete snapshot lists
 * every pending request, so it replaces the list. A partial one leaves requests out that are still
 * pending, so the client keeps them and replaces only the ones the snapshot names.
 */
export function reconcilePendingRequests<Item extends { requestId: string | number }>(
  current: readonly Item[],
  snapshotItems: readonly Item[],
  attentionComplete: boolean,
): Item[] {
  if (attentionComplete) return [...snapshotItems];
  const named = new Set(snapshotItems.map((item) => String(item.requestId)));
  return [...current.filter((item) => !named.has(String(item.requestId))), ...snapshotItems];
}
