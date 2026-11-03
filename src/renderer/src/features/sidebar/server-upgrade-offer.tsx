import {
  BILLING_PLAN_IDS,
  type BillingPlanId,
  type BillingServerPlan,
  isOpenBillingStatus,
} from "@openbot/contracts/billing";
import type { ServerSummary } from "@openbot/contracts/ipc";
import { ServerUpgradeDialog } from "@openbot/ui/features/servers/ServerUpgradeDialog";
import type { SidebarStorageLevel } from "@openbot/ui/features/sidebar/SidebarStorageCard";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, Show, untrack } from "solid-js";
import { appPort } from "../../app-port";
import { usePlatform } from "../../platform";

/**
 * The highest level offered for each server, on this computer. The dialog shows once at "low" and
 * once more at "full". When space comes back, the storage card clears the record.
 */
const OFFERED_KEY_PREFIX = "openbot:server-upgrade-offered:";

const LEVEL_RANK: Record<SidebarStorageLevel, number> = { low: 1, full: 2 };

function readOffered(serverId: string): SidebarStorageLevel | null {
  try {
    const value = window.localStorage.getItem(OFFERED_KEY_PREFIX + serverId);
    return value === "low" || value === "full" ? value : null;
  } catch {
    return null;
  }
}

/** False when browser storage is unavailable. The dialog then does not show, so it cannot repeat. */
function writeOffered(serverId: string, level: SidebarStorageLevel): boolean {
  try {
    window.localStorage.setItem(OFFERED_KEY_PREFIX + serverId, level);
    return true;
  } catch {
    return false;
  }
}

/** Space came back, so the next "low" offers the upgrade again. */
export function clearServerUpgradeOffered(serverId: string): void {
  try {
    window.localStorage.removeItem(OFFERED_KEY_PREFIX + serverId);
  } catch {
    // The record stays, and the dialog shows again only at a higher level.
  }
}

/** The plan after `plan`, or null for the largest plan. */
function nextPlan(plan: BillingPlanId): BillingPlanId | null {
  return BILLING_PLAN_IDS[BILLING_PLAN_IDS.indexOf(plan) + 1] ?? null;
}

interface StorageCard {
  level: SidebarStorageLevel;
  serverId: string;
  freeBytes: number;
  totalBytes: number;
}

interface Offer {
  serverId: string;
  level: SidebarStorageLevel;
  plan: BillingServerPlan;
  nextPlan: BillingPlanId;
}

/**
 * Offers the next plan when the disk of a hosted server is almost full. Only the account that pays for
 * the server gets the offer, because the plan change needs its subscription. The largest plan, a plan
 * that ends, and a server that the account does not pay for get only the sidebar card.
 */
export function ServerUpgradeOffer(props: {
  card: StorageCard | null;
  server: ServerSummary | undefined;
  /** Another dialog is open, such as Server settings. The offer waits. */
  blocked: boolean;
  onFreeUpSpace: (serverId: string) => void;
}) {
  const { t, errorMessage } = useText();
  const platform = usePlatform();
  const [state, setState] = createStore<{ offer: Offer | null; pending: boolean; error: string | null }>({
    offer: null,
    pending: false,
    error: null,
  });

  /** Server and level pairs that this window asked billing about, so focus changes do not ask again. */
  const asked = new Set<string>();

  createEffect(
    () => {
      const card = props.card;
      const server = props.server;
      if (!card || !server?.hosted || server.id !== card.serverId) return null;
      if (props.blocked || !platform.appFocused() || platform.chatWindow || platform.landingPreview) return null;
      if (untrack(() => state.offer)) return null;
      const offered = readOffered(card.serverId);
      if (offered && LEVEL_RANK[offered] >= LEVEL_RANK[card.level]) return null;
      if (asked.has(`${card.serverId}:${card.level}`)) return null;
      return { serverId: card.serverId, level: card.level };
    },
    (candidate) => {
      if (!candidate) return;
      const key = `${candidate.serverId}:${candidate.level}`;
      asked.add(key);
      let current = true;
      let settled = false;
      appPort()
        .billing.getState()
        .then(
          (billing) => {
            if (!current) return;
            settled = true;
            const plan = billing.servers.find(
              (entry) =>
                entry.serverId === candidate.serverId && isOpenBillingStatus(entry.status) && !entry.cancelAtPeriodEnd,
            );
            const next = plan ? nextPlan(plan.plan) : null;
            if (!plan || !next || !writeOffered(candidate.serverId, candidate.level)) return;
            setState((draft) => {
              draft.offer = { serverId: candidate.serverId, level: candidate.level, plan, nextPlan: next };
              draft.pending = false;
              draft.error = null;
            });
          },
          // Without the plan there is nothing to offer. The sidebar card still shows; the next change asks again.
          () => {
            asked.delete(key);
          },
        );
      return () => {
        // A change before the answer, such as a lost focus, drops it. The next candidate asks again.
        current = false;
        if (!settled) asked.delete(key);
      };
    },
  );

  function close(): void {
    setState((draft) => {
      draft.offer = null;
    });
  }

  async function upgrade(offer: Offer): Promise<void> {
    if (state.pending) return;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      await appPort().billing.openPortal({ flow: "update", subscriptionId: offer.plan.subscriptionId });
      close();
    } catch (error) {
      setState((draft) => {
        draft.error = errorMessage(error, t("billing.portalFailed"));
      });
    } finally {
      setState((draft) => {
        draft.pending = false;
      });
    }
  }

  /** The disk as the card reads it now, or as it was when the offer opened. */
  const disk = (offer: Offer) => (props.card?.serverId === offer.serverId ? props.card : null);

  return (
    <Show when={state.offer}>
      {(offer) => (
        <ServerUpgradeDialog
          serverName={props.server?.name ?? ""}
          level={disk(offer())?.level ?? offer().level}
          freeBytes={disk(offer())?.freeBytes ?? 0}
          totalBytes={disk(offer())?.totalBytes ?? 0}
          plan={offer().plan.plan}
          nextPlan={offer().nextPlan}
          interval={offer().plan.interval}
          currency={offer().plan.currency}
          amount={offer().plan.amount}
          pending={state.pending}
          error={state.error}
          onUpgrade={() => void upgrade(offer())}
          onFreeUpSpace={() => {
            const { serverId } = offer();
            close();
            props.onFreeUpSpace(serverId);
          }}
          onClose={close}
        />
      )}
    </Show>
  );
}
