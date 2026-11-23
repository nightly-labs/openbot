export type DownloadLimit = <T>(task: () => Promise<T>) => Promise<T>;

export function createDownloadLimit(limit: number): DownloadLimit {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) active += 1;
    else await new Promise<void>((start) => waiting.push(start));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
