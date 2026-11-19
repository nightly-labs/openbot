import type { WorkflowMediaCredits } from "@openbot/contracts/ipc";
import type { MediaCreditsRailRow } from "@openbot/ui/features/window/PageRail";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

const SUNRA_NAME = "Sunra";
const HIGGSFIELD_NAME = "Higgsfield";

const [mediaStepsEnded, setMediaStepsEnded] = createSignal(0);

export function noteMediaStepEnded(): void {
  setMediaStepsEnded((count) => count + 1);
}

export function createWorkflowMediaCredits(
  server: () => string | null,
  read: (serverId: string) => Promise<WorkflowMediaCredits>,
) {
  const [credits, setCredits] = createSignal<WorkflowMediaCredits | null>(null);
  let current: string | null = null;
  let request = 0;
  const refresh = () => {
    const serverId = current;
    if (!serverId) return;
    request += 1;
    const sent = request;
    read(serverId).then(
      (answer) => {
        if (sent === request) setCredits(answer);
      },
      () => undefined,
    );
  };
  createEffect(server, (serverId) => {
    current = serverId;
    request += 1;
    setCredits(null);
    refresh();
  });
  let ended = untrack(mediaStepsEnded);
  createEffect(mediaStepsEnded, (count) => {
    if (count === ended) return;
    ended = count;
    refresh();
  });
  window.addEventListener("focus", refresh);
  onCleanup(() => {
    current = null;
    request += 1;
    window.removeEventListener("focus", refresh);
  });
  return (): MediaCreditsRailRow[] => {
    const answer = credits();
    const rows: MediaCreditsRailRow[] = [];
    if (answer?.sunra) rows.push({ provider: "sunra", name: SUNRA_NAME, ...answer.sunra });
    if (answer?.higgsfield) rows.push({ provider: "higgsfield", name: HIGGSFIELD_NAME, ...answer.higgsfield });
    return rows;
  };
}
