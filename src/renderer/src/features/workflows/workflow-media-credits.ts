import type { WorkflowMediaCreditBalance, WorkflowMediaCredits } from "@openbot/contracts/ipc";
import type { MediaCreditsRailRow } from "@openbot/ui/features/window/PageRail";
import { createEffect, createSignal, onCleanup } from "solid-js";

/** A brand name: it is not translated. */
const SUNRA_NAME = "Sunra";

/**
 * The Sunra credits of one server while the Canvas page shows it. `server` is the id of that server,
 * or null while the page does not show. The credits are read when the page opens on a server, and
 * again when the window comes back to the front: a run, or a person in the browser, can spend them.
 * A failed read keeps the last answer.
 */
export function createWorkflowMediaCredits(
  server: () => string | null,
  read: (serverId: string) => Promise<WorkflowMediaCredits>,
) {
  const [credits, setCredits] = createSignal<WorkflowMediaCreditBalance | null>(null);
  let current: string | null = null;
  /** Each read has a number. An answer for an older read, or for another server, is dropped. */
  let request = 0;
  const refresh = () => {
    const serverId = current;
    if (!serverId) return;
    request += 1;
    const sent = request;
    read(serverId).then(
      (answer) => {
        if (sent === request) setCredits(answer.sunra);
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
  window.addEventListener("focus", refresh);
  onCleanup(() => {
    current = null;
    request += 1;
    window.removeEventListener("focus", refresh);
  });
  /** The rail rows of the credits: Sunra, when it told them. */
  return (): MediaCreditsRailRow[] => {
    const sunra = credits();
    return sunra ? [{ provider: "sunra", name: SUNRA_NAME, ...sunra }] : [];
  };
}
