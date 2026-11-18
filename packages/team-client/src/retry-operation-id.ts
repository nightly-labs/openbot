/** How long a failed write keeps its id for a retry. Later, the same write is a new write. */
const RETRY_WINDOW_MS = 10 * 60_000;

/**
 * The operation ids of writes that a client can send again. A failed write can still have committed
 * on the host (the answer got lost), so a retry of the same write sends the same id, and the host
 * gives the first result. `request` names the write; call `failed` when it fails.
 *
 * Only the last failed write keeps its id, for 10 minutes: a retry comes next. A write that comes
 * after another write, or later, gets a new id, so the host does not drop it as a copy.
 */
export function retryOperationIds(makeId: () => string) {
  let failedWrite: { key: string; id: string; at: number } | null = null;
  return (request: unknown) => {
    const key = JSON.stringify(request);
    const retry = failedWrite?.key === key && Date.now() - failedWrite.at < RETRY_WINDOW_MS ? failedWrite.id : null;
    failedWrite = null;
    const id = retry ?? makeId();
    return {
      id,
      failed: () => {
        failedWrite = { key, id, at: Date.now() };
      },
    };
  };
}
