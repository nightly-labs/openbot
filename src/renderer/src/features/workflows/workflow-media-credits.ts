import type {
  WorkflowCatalogProvider,
  WorkflowMediaCredits,
  WorkflowMediaServiceAccount,
} from "@openbot/contracts/ipc";
import type { MediaCreditsRailRow } from "@openbot/ui/features/window/PageRail";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

const MEDIA_SERVICE_NAMES: Readonly<Record<WorkflowCatalogProvider, string>> = {
  sunra: "Sunra",
  higgsfield: "Higgsfield",
};

export const mediaServiceAccountName = (account: WorkflowMediaServiceAccount) =>
  account.name ?? MEDIA_SERVICE_NAMES[account.provider];

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
    if (!answer) return [];
    if (answer.accounts) {
      const accounts = answer.accounts;
      return accounts.flatMap((account) => {
        if (!account.credits) return [];
        const service = accounts.filter((entry) => entry.provider === account.provider);
        return [
          {
            key: `${account.provider}:${account.id}`,
            provider: account.provider,
            name: mediaServiceAccountName(account),
            ...account.credits,
            ...(service.length > 1 ? { number: service.indexOf(account) + 1 } : {}),
          },
        ];
      });
    }
    const rows: MediaCreditsRailRow[] = [];
    if (answer.sunra) rows.push({ key: "sunra", provider: "sunra", name: MEDIA_SERVICE_NAMES.sunra, ...answer.sunra });
    if (answer.higgsfield)
      rows.push({
        key: "higgsfield",
        provider: "higgsfield",
        name: MEDIA_SERVICE_NAMES.higgsfield,
        ...answer.higgsfield,
      });
    return rows;
  };
}
