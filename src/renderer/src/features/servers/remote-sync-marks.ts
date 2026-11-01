import { markRemoteSync } from "@openbot/team-client/sync-profile";
import { createEffect } from "solid-js";

/**
 * Marks each step of a remote workspace load the first time its condition holds, for
 * `bun run perf:remote`. A mark holds only the fixed step name.
 */
export function createRemoteSyncMarks(steps: Readonly<Record<string, () => boolean>>): void {
  for (const [name, reached] of Object.entries(steps)) {
    let marked = false;
    createEffect(reached, (done) => {
      if (!done || marked) return;
      marked = true;
      markRemoteSync(name);
    });
  }
}
