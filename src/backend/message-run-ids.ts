/**
 * The ids of a message that runs again in a Claude process that already took its uuid. The CLI does
 * not run a uuid again and sends no result for it (#6676), so each run gets its own uuid. Run `n`
 * keeps the message's uuid and changes its last 8 digits by `n`, so provider history names the
 * message again without a stored list of the run ids.
 */
const MAX_RUNS = 16;

function withRun(id: string, run: number): string {
  const tail = Number.parseInt(id.slice(-8), 16);
  return `${id.slice(0, -8)}${((tail ^ run) >>> 0).toString(16).padStart(8, "0")}`;
}

/** The first id of the message that `taken` does not hold, or null when each run id is taken. */
export function untakenRunId(id: string, taken: ReadonlySet<string>): string | null {
  for (let run = 0; run <= MAX_RUNS; run += 1) {
    const candidate = run === 0 ? id : withRun(id, run);
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** The ids that a run id can come from, the id itself first. */
export function runIdOrigins(id: string): string[] {
  if (!/^[0-9a-f]{8}$/i.test(id.slice(-8))) return [id];
  return [id, ...Array.from({ length: MAX_RUNS }, (_, index) => withRun(id, index + 1))];
}
