import {
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
  billingListPrices,
  serverStorageGb,
  serverStorageGbAfter,
} from "@openbot/contracts/billing";
import { HOSTED_PLAN_SIZE, HOSTED_SERVER_SIZES } from "@openbot/contracts/hosted-servers";
import { Button, Dialog, Progress } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { formatMinorMoney } from "../billing/money";

const PLAN_NAMES = {
  starter: "billing.plan.starter",
  standard: "billing.plan.standard",
  pro: "billing.plan.pro",
} as const satisfies Record<BillingPlanId, string>;

export interface ServerUpgradeDialogProps {
  serverName: string;
  /** "full" shows the meter in the danger color. */
  level: "low" | "full";
  freeBytes: number;
  totalBytes: number;
  plan: BillingPlanId;
  /** The storage of the server now in GB, from the account server. Without it the plan table decides. */
  storageGb?: number | undefined;
  nextPlan: BillingPlanId;
  interval: BillingInterval;
  currency: BillingCurrency;
  /** The Stripe list price of one period of `plan`, in minor units. Null shows the OpenBot list price. */
  amount: number | null;
  /** The plan change page of the Customer Portal is opening. */
  pending: boolean;
  error: string | null;
  onUpgrade: () => void;
  onFreeUpSpace: () => void;
  onClose: () => void;
}

/**
 * The offer of the next plan when the disk of a hosted server is almost full. It compares the disk,
 * the memory and the price of the two plans. "Upgrade" opens the plan change of the Customer Portal.
 */
export function ServerUpgradeDialog(props: ServerUpgradeDialogProps) {
  const { t, format } = useText();
  let upgrade: HTMLButtonElement | undefined;
  const usedBytes = () => Math.max(0, props.totalBytes - props.freeBytes);
  // Round down so that a nearly full disk does not show 100% while space is left.
  const percent = () => (props.totalBytes > 0 ? Math.floor((usedBytes() / props.totalBytes) * 100) : 0);
  const memoryGb = (plan: BillingPlanId) => HOSTED_SERVER_SIZES[HOSTED_PLAN_SIZE[plan]].memoryGb;
  const price = (amount: number) =>
    t(props.interval === "month" ? "billing.server.price.month" : "billing.server.price.year", {
      amount: formatMinorMoney(format, amount, props.currency),
    });
  // Plan sizes are whole GB, as Billing shows them.
  const gigabytes = (size: number) => t("format.fileSize.gigabytes", { size: format.number(size) });
  const listPrice = (plan: BillingPlanId) => billingListPrices(plan, props.interval)[props.currency];
  const rows = () => [
    {
      label: t("files.machine.disk"),
      now: gigabytes(serverStorageGb(props)),
      next: gigabytes(serverStorageGbAfter(props, props.nextPlan)),
    },
    {
      label: t("files.machine.memory"),
      now: gigabytes(memoryGb(props.plan)),
      next: gigabytes(memoryGb(props.nextPlan)),
    },
    {
      label: t("server.upgrade.price"),
      now: price(props.amount ?? listPrice(props.plan)),
      next: price(listPrice(props.nextPlan)),
    },
  ];
  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content
            as="section"
            class="hosted-upsell-modal server-upgrade-modal"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              upgrade?.focus({ preventScroll: true });
            }}
          >
            <Dialog.Title as="h2" class="hosted-upsell-modal-title">
              {t("server.upgrade.title")}
            </Dialog.Title>
            <div class="server-upgrade-meter" data-level={props.level}>
              <Progress
                value={percent()}
                aria-label={t("sidebar.storage.meterLabel", { server: props.serverName })}
                getValueLabel={() => t("sidebar.storage.used", { percent: format.percent(percent() / 100) })}
              />
              <span>
                {t("server.upgrade.used", {
                  used: format.fileSize(usedBytes()),
                  total: format.fileSize(props.totalBytes),
                })}
              </span>
            </div>
            <Dialog.Description as="p" class="hosted-upsell-modal-description">
              {t("server.upgrade.description", { server: props.serverName })}
            </Dialog.Description>
            <table class="server-upgrade-compare">
              <thead>
                <tr>
                  <td />
                  <th scope="col">{t("server.upgrade.current", { plan: t(PLAN_NAMES[props.plan]) })}</th>
                  <th scope="col">{t(PLAN_NAMES[props.nextPlan])}</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(row) => (
                    <tr>
                      <th scope="row">{row.label}</th>
                      <td>{row.now}</td>
                      <td>{row.next}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={props.error}>
              {(error) => (
                <p class="server-upgrade-error" role="alert">
                  {error()}
                </p>
              )}
            </Show>
            <footer class="hosted-upsell-modal-actions">
              <Button variant="ghost" onClick={() => props.onClose()}>
                {t("server.upsell.notNow")}
              </Button>
              <Button variant="outline" onClick={() => props.onFreeUpSpace()}>
                {t("sidebar.storage.freeUpSpace")}
              </Button>
              <Button ref={(element) => (upgrade = element)} disabled={props.pending} onClick={() => props.onUpgrade()}>
                {props.pending
                  ? t("billing.opening")
                  : t("server.upgrade.action", { plan: t(PLAN_NAMES[props.nextPlan]) })}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
