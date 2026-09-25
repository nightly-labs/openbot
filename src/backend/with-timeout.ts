/** The rejection of `withTimeout`, so a caller can tell its own timer from an error `work` threw. */
export class TimeoutError extends Error {}

/**
 * Settles as `work` settles, or rejects with `message` after `timeoutMs`. The timer is cleared in
 * both cases. `work` itself keeps running: the caller only stops waiting for it.
 */
export async function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
