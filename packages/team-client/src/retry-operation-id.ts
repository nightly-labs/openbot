/**
 * The operation ids of writes that a client can send again. A failed write can still have committed
 * on the host (the answer got lost), so a retry of the same write sends the same id, and the host
 * gives the first result. `request` names the write; call `failed` when it fails.
 */
export function retryOperationIds(makeId: () => string) {
  const failedWrites = new Map<string, string>();
  return (request: unknown) => {
    const key = JSON.stringify(request);
    const id = failedWrites.get(key) ?? makeId();
    failedWrites.delete(key);
    return { id, failed: () => void failedWrites.set(key, id) };
  };
}
