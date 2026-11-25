const RETRY_WINDOW_MS = 10 * 60_000;

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
