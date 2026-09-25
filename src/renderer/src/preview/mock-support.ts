// What the preview modules share. Each `createMock*` module owns the state of its own groups and gets
// the event and timer helpers from `createMockOpenBot`, so `dispose` there still ends every timer.

export type Listener<T> = (value: T) => void;

export interface MockRuntime {
  /** Sends a copy, so a listener that keeps the value cannot change the preview's own state. */
  emit: <T>(listeners: Set<Listener<T>>, value: T) => void;
  schedule: (callback: () => void, delay?: number) => void;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function matchesQuery(text: string, query: string | undefined): boolean {
  return !query || text.toLowerCase().includes(query.toLowerCase());
}
