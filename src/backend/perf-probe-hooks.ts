export interface PerfIpcTarget {
  send(channel: string, ...args: unknown[]): void;
}

export interface PerfProbeSink {
  count(key: string, amount: number): void;
  time(key: string, ms: number): void;
  ipcSend(target: PerfIpcTarget, channel: string, args: readonly unknown[]): void;
}

let sink: PerfProbeSink | null = null;

export function setPerfProbeSink(next: PerfProbeSink | null): void {
  sink = next;
}

export function perfCount(key: string, amount = 1): void {
  sink?.count(key, amount);
}

export function perfTime(key: string, ms: number): void {
  sink?.time(key, ms);
}

export function perfTimed<Result>(key: string, run: () => Result): Result {
  const active = sink;
  if (!active) return run();
  const startedAt = performance.now();
  try {
    return run();
  } finally {
    active.time(key, performance.now() - startedAt);
  }
}

export function perfIpcSend(target: PerfIpcTarget, channel: string, args: readonly unknown[]): void {
  sink?.ipcSend(target, channel, args);
}
