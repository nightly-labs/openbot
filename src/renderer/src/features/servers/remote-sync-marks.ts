import { markRemoteSync } from "@openbot/team-client/sync-profile";
import { createEffect } from "solid-js";

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
