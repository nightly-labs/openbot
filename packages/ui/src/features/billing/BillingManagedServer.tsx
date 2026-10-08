import { BILLING_PLANS, type BillingServerPlan } from "@openbot/contracts/billing";
import type { HostedServerSummary } from "@openbot/contracts/hosted-servers";
import { createStore } from "solid-js";
import { useText } from "../../text";
import type { SettingsHostedServersStore } from "../settings/stores/hosted-servers-store";
import { BillingServerLifecycle, type BillingServerLifecycleAction } from "./BillingServerLifecycle";
import type { BillingStore } from "./billing-store";

export function BillingManagedServer(props: {
  server: HostedServerSummary;
  plan: BillingServerPlan;
  paidThrough: number;
  billing: BillingStore;
  hosting: SettingsHostedServersStore;
}) {
  const { t, format, errorMessage } = useText();
  const [dialog, setDialog] = createStore<{
    action: BillingServerLifecycleAction | null;
    timing: "period-end" | "now";
    name: string;
    pending: boolean;
    error: string | null;
  }>({ action: null, timing: "period-end", name: "", pending: false, error: null });
  async function confirm() {
    const action = dialog.action;
    if (!action || dialog.pending) return;
    if (action === "delete" && dialog.name !== props.server.name) {
      setDialog((draft) => {
        draft.error = t("settings.hostedServers.deleteNameMismatch");
      });
      return;
    }
    setDialog((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      await props.hosting.lifecycle({
        expectedPeriodEnd: props.paidThrough,
        serverId: props.server.serverId,
        action,
        timing: dialog.timing,
        confirmName: dialog.name,
      });
      await props.billing.load();
      setDialog((draft) => {
        draft.action = null;
      });
    } catch (error) {
      // A lost response can follow a completed Stripe mutation. Read the actual state.
      await props.hosting.load();
      await props.billing.load();
      setDialog((draft) => {
        draft.error = errorMessage(error, t("billing.lifecycle.failed"));
      });
    } finally {
      setDialog((draft) => {
        draft.pending = false;
      });
    }
  }
  const planNames = {
    starter: "billing.plan.starter",
    standard: "billing.plan.standard",
    pro: "billing.plan.pro",
  } as const;
  const stateNames = {
    awaiting_payment: "settings.hostedServers.state.awaitingPayment",
    creating: "settings.hostedServers.state.creating",
    starting: "settings.hostedServers.state.starting",
    running: "settings.hostedServers.state.running",
    stopping: "settings.hostedServers.state.stopping",
    stopped: "settings.hostedServers.state.stopped",
    waking: "settings.hostedServers.state.waking",
    error: "settings.hostedServers.state.error",
    deleted: "settings.hostedServers.state.deleted",
  } as const;
  const price = () => {
    if (props.plan.amount === null)
      return t(props.plan.interval === "month" ? "billing.interval.month" : "billing.interval.year");
    return t(props.plan.interval === "month" ? "billing.server.price.month" : "billing.server.price.year", {
      amount: format.number(props.plan.amount / 100, {
        style: "currency",
        currency: props.plan.currency.toUpperCase(),
        minimumFractionDigits: props.plan.amount % 100 === 0 ? 0 : 2,
      }),
    });
  };
  return (
    <BillingServerLifecycle
      name={props.server.name}
      planDescription={t("billing.server.summary", {
        plan: t(planNames[props.plan.plan]),
        size: format.number(BILLING_PLANS.find((plan) => plan.id === props.plan.plan)?.storageGb ?? 0),
      })}
      price={price()}
      paidThrough={props.server.deletionScheduledAt ?? props.paidThrough}
      running={props.server.state === "running"}
      statusLabel={t(stateNames[props.server.state])}
      cancelAtPeriodEnd={props.plan.cancelAtPeriodEnd}
      scheduled={props.server.deletionScheduledAt != null}
      deleted={false}
      action={dialog.action}
      deletionTiming={dialog.timing}
      confirmName={dialog.name}
      pending={dialog.pending}
      error={dialog.error}
      onAction={(action) =>
        setDialog((draft) => {
          draft.action = action;
          draft.name = "";
          draft.error = null;
          draft.timing = "period-end";
        })
      }
      onTimingChange={(timing) =>
        setDialog((draft) => {
          draft.timing = timing;
          draft.error = null;
        })
      }
      onNameChange={(name) =>
        setDialog((draft) => {
          draft.name = name;
          draft.error = null;
        })
      }
      onCancel={() => {
        if (!dialog.pending)
          setDialog((draft) => {
            draft.action = null;
          });
      }}
      onConfirm={() => void confirm()}
      onChangePlan={
        props.server.deletionScheduledAt == null
          ? () => void props.billing.openPortal({ flow: "update", subscriptionId: props.plan.subscriptionId })
          : undefined
      }
      onWake={
        props.server.state === "stopped" && props.server.error !== "plan_ended"
          ? () => void props.hosting.wake(props.server)
          : undefined
      }
    />
  );
}
