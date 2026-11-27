export const MAX_RUNS = 16;

function withRun(id: string, run: number): string {
  const tail = Number.parseInt(id.slice(-8), 16);
  return `${id.slice(0, -8)}${((tail ^ run) >>> 0).toString(16).padStart(8, "0")}`;
}

export function untakenRunId(id: string, taken: ReadonlySet<string>): string | null {
  for (let run = 0; run <= MAX_RUNS; run += 1) {
    const candidate = run === 0 ? id : withRun(id, run);
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

export function runIdOrigins(id: string): string[] {
  if (!/^[0-9a-f]{8}$/i.test(id.slice(-8))) return [id];
  return [id, ...Array.from({ length: MAX_RUNS }, (_, index) => withRun(id, index + 1))];
}
