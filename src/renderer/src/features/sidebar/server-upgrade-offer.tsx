import {
  type BillingServerPlan,
  type BillingStorageUpgradeTier,
  isOpenBillingStatus,
  serverStorageGb,
} from "@openbot/contracts/billing";
import type { ServerSummary } from "@openbot/contracts/ipc";
import type { BillingCalls } from "@openbot/ui/features/billing/billing-store";
import { StorageTierDialog } from "@openbot/ui/features/billing/StorageTierDialog";
import type { SidebarStorageLevel } from "@openbot/ui/features/sidebar/SidebarStorageCard";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, Show, untrack } from "solid-js";
import { usePlatform } from "../../platform";
import { readUpgradeOffered, writeUpgradeOffered } from "./storage-card";

const LEVEL_RANK: Record<SidebarStorageLevel, number> = { low: 1, full: 2 };

interface StorageCard {
  level: SidebarStorageLevel;
  serverId: string;
  freeBytes: number;
  totalBytes: number;
}

interface Offer {
  card: StorageCard;
  serverName: string;
  plan: BillingServerPlan;
}

/**
 * Offers a larger storage tier when the disk of a hosted server is almost full. Only the account that
 * pays for the server gets the offer, because the tier is added to its subscription. A server with no
 * tier to buy (a boat sandbox, the largest tier, a plan that ends, or an account server from before
 * storage tiers) and a server that the account does not pay for get only the sidebar card.
 * Desktop and the web client show it.
 */
export function ServerUpgradeOffer(props: {
  /** Desktop IPC, or the web client's account server requests. */
  billing: Pick<BillingCalls, "getState" | "buyStorage">;
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

  /** The offer of the selected server only. The tier applies to the server that the dialog names. */
  const shown = () => (state.offer?.card.serverId === props.server?.id ? state.offer : null);

  /** "<server>:<level>" pairs that have no tier to offer. They are asked again after space comes back. */
  const noOffer = new Set<string>();
  createEffect(
    () => props.card === null,
    (gone) => {
      if (gone) noOffer.clear();
    },
  );

  // The key is a string, so a new card or server object with the same level does not ask billing again.
  createEffect(
    () => {
      const card = props.card;
      const server = props.server;
      if (!card || !server?.hosted || server.id !== card.serverId) return null;
      if (props.blocked || !platform.appFocused() || platform.chatWindow || platform.landingPreview) return null;
      // An open offer waits. An offer for a server that is no longer selected gives way.
      if (untrack(shown)) return null;
      const offered = readUpgradeOffered(card.serverId);
      if (offered && LEVEL_RANK[offered] >= LEVEL_RANK[card.level]) return null;
      const key = `${card.serverId}:${card.level}`;
      return noOffer.has(key) ? null : key;
    },
    (key) => {
      if (!key) return;
      let current = true;
      props.billing.getState().then(
        (billing) => {
          const card = untrack(() => props.card);
          const server = untrack(() => props.server);
          if (!current || !card || !server || `${card.serverId}:${card.level}` !== key) return;
          const plan = billing.servers.find(
            (entry) =>
              entry.serverId === card.serverId &&
              isOpenBillingStatus(entry.status) &&
              !entry.cancelAtPeriodEnd &&
              (entry.storageUpgrades?.length ?? 0) > 0,
          );
          if (!plan) {
            noOffer.add(key);
            return;
          }
          if (!writeUpgradeOffered(card.serverId, card.level)) return;
          setState((draft) => {
            draft.offer = { card: { ...card }, serverName: server.name, plan };
            draft.pending = false;
            draft.error = null;
          });
        },
        // Without the plan there is nothing to offer. The sidebar card still shows; the next change asks again.
        () => undefined,
      );
      // A change before the answer, such as a lost focus, drops the answer.
      return () => {
        current = false;
      };
    },
  );

  function close(): void {
    setState((draft) => {
      draft.offer = null;
    });
  }

  async function buy(offer: Offer, tier: BillingStorageUpgradeTier): Promise<void> {
    if (state.pending) return;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      await props.billing.buyStorage({ subscriptionId: offer.plan.subscriptionId, tier });
      close();
    } catch (error) {
      setState((draft) => {
        draft.error = errorMessage(error, t("billing.storage.failed"));
      });
    } finally {
      setState((draft) => {
        draft.pending = false;
      });
    }
  }

  /** The disk as the card reads it now, or as it was when the offer opened. */
  const disk = (offer: Offer) => (props.card?.serverId === offer.card.serverId ? props.card : offer.card);

  return (
    <Show when={shown()}>
      {(offer) => (
        <StorageTierDialog
          mode="offer"
          serverName={offer().serverName}
          disk={disk(offer())}
          storageGb={serverStorageGb(offer().plan)}
          interval={offer().plan.interval}
          currency={offer().plan.currency}
          amount={offer().plan.amount}
          upgrades={offer().plan.storageUpgrades ?? []}
          pending={state.pending}
          error={state.error}
          onBuy={(tier) => void buy(offer(), tier)}
          onFreeUpSpace={() => {
            const { serverId } = offer().card;
            close();
            props.onFreeUpSpace(serverId);
          }}
          onClose={() => {
            if (!state.pending) close();
          }}
        />
      )}
    </Show>
  );
}
