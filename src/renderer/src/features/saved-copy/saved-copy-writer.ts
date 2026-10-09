/**
 * A save that runs at once, and then at most once each `intervalMs` with the newest value. A busy
 * chat changes its unread counts and messages often, and the copy needs only the last of them.
 * `flush` runs a value that still waits, for a scope that closes.
 */
export function createThrottledSave<Value>(save: (value: Value) => void, intervalMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting: { value: Value } | null = null;

  function run(value: Value): void {
    save(value);
    timer = setTimeout(() => {
      timer = undefined;
      const next = waiting;
      waiting = null;
      if (next) run(next.value);
    }, intervalMs);
  }

  return {
    offer(value: Value): void {
      if (timer === undefined) run(value);
      else waiting = { value };
    },
    flush(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const next = waiting;
      waiting = null;
      if (next) save(next.value);
    },
  };
}
