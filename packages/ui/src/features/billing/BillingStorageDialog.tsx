import { type BillingServerPlan, type BillingStorageUpgradeTier, serverStorageGb } from "@openbot/contracts/billing";
import { createStore } from "solid-js";
import { useText } from "../../text";
import type { BillingStore } from "./billing-store";
import { StorageTierDialog } from "./StorageTierDialog";

/** "Add storage" in Billing: the storage tier choice of one plan, bought through the Billing store. */
export function BillingStorageDialog(props: {
  plan: BillingServerPlan;
  serverName: string;
  store: BillingStore;
  onClose: () => void;
}) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{ pending: boolean; error: string | null }>({ pending: false, error: null });

  async function buy(tier: BillingStorageUpgradeTier): Promise<void> {
    if (state.pending) return;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      await props.store.buyStorage({ subscriptionId: props.plan.subscriptionId, tier });
      props.onClose();
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

  return (
    <StorageTierDialog
      mode="billing"
      serverName={props.serverName}
      storageGb={serverStorageGb(props.plan)}
      interval={props.plan.interval}
      currency={props.plan.currency}
      amount={props.plan.amount}
      upgrades={props.plan.storageUpgrades ?? []}
      pending={state.pending}
      error={state.error}
      onBuy={(tier) => void buy(tier)}
      onClose={() => {
        if (!state.pending) props.onClose();
      }}
    />
  );
}
