export function oneAtATimePerKey(): <T>(key: string, change: () => Promise<T>) => Promise<T> {
  const pending = new Map<string, Promise<unknown>>();
  return (key, change) => {
    const result = (pending.get(key) ?? Promise.resolve()).then(change);
    const settled = result.catch(() => undefined);
    pending.set(key, settled);
    void settled.then(() => {
      if (pending.get(key) === settled) pending.delete(key);
    });
    return result;
  };
}
