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

export function ServerUpgradeOffer(props: {
  billing: Pick<BillingCalls, "getState" | "buyStorage">;
  card: StorageCard | null;
  server: ServerSummary | undefined;
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

  const shown = () => (state.offer?.card.serverId === props.server?.id ? state.offer : null);

  const noOffer = new Set<string>();
  createEffect(
    () => props.card === null,
    (gone) => {
      if (gone) noOffer.clear();
    },
  );

  createEffect(
    () => {
      const card = props.card;
      const server = props.server;
      if (!card || !server?.hosted || server.id !== card.serverId) return null;
      if (props.blocked || !platform.appFocused() || platform.chatWindow || platform.landingPreview) return null;
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
        () => undefined,
      );
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
