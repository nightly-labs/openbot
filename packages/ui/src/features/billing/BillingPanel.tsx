import {
  BILLING_PLANS,
  type BillingInterval,
  type BillingPlanId,
  type BillingPortalRequest,
  type BillingServerPlan,
  type BillingSubscriptionStatus,
} from "@openbot/contracts/billing";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Badge,
  Button,
  buttonVariants,
  CreditCard,
  DropdownMenu,
  Ellipsis,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  OctagonX,
  RotateCcw,
  ServerGradientLogo,
  SlidersHorizontal,
  Spinner,
  Text,
  TriangleAlert,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { type BillingStore, billingActionKey } from "./billing-store";

const PLAN_NAME = {
  starter: "billing.plan.starter",
  standard: "billing.plan.standard",
  pro: "billing.plan.pro",
} as const satisfies Record<BillingPlanId, AppTextKey>;

const INTERVAL_LABEL = {
  month: "billing.interval.month",
  year: "billing.interval.year",
} as const satisfies Record<BillingInterval, AppTextKey>;

/** The statuses that show a badge. An active plan shows none. */
const STATUS_BADGE: Partial<
  Record<BillingSubscriptionStatus, { text: AppTextKey; variant: "info-light" | "destructive-light" | "warning-light" }>
> = {
  trialing: { text: "billing.status.trialing", variant: "info-light" },
  past_due: { text: "billing.status.paymentFailed", variant: "destructive-light" },
  unpaid: { text: "billing.status.paymentFailed", variant: "destructive-light" },
  paused: { text: "billing.status.paused", variant: "warning-light" },
};

function paymentFailed(server: BillingServerPlan): boolean {
  return server.status === "past_due" || server.status === "unpaid";
}

export interface BillingPanelProps {
  store: BillingStore;
  /** False when this surface has no billing calls. */
  available: boolean;
}

/**
 * The Billing content of the desktop Settings tab and the web dialog: the plan of each server that
 * the account pays for, with the Stripe Customer Portal for plan changes, the payment method and
 * the invoices. The plan of a new server is chosen where the server is made, not here.
 */
export function BillingPanel(props: BillingPanelProps): JSX.Element {
  const { t } = useText();
  const billing = () => props.store.state.billing;
  const unavailable = () => !props.available || billing()?.available === false;
  const managing = () => props.store.state.pending === "manage";

  return (
    <div class="billing-panel" aria-busy={props.store.state.loading ? "true" : undefined}>
      <Show when={!unavailable() && billing()}>
        <Show when={props.store.state.error}>
          {(message) => <BillingError message={message()} store={props.store} />}
        </Show>
        <Show when={props.store.state.actionError}>
          {(message) => (
            <Alert tone="danger" role="alert">
              <AlertIcon>
                <TriangleAlert aria-hidden="true" />
              </AlertIcon>
              <AlertContent>
                <AlertDescription>{message()}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
        </Show>
      </Show>
      <Switch>
        <Match when={unavailable()}>
          <Text tone="muted">{t("billing.unavailable")}</Text>
        </Match>
        <Match when={!billing() && props.store.state.error}>
          {(message) => <BillingError message={message()} store={props.store} />}
        </Match>
        <Match when={billing()}>
          {(state) => (
            <>
              <Show when={state().servers.some(paymentFailed)}>
                <Alert tone="warning">
                  <AlertIcon>
                    <TriangleAlert aria-hidden="true" />
                  </AlertIcon>
                  <AlertContent>
                    <AlertDescription>{t("billing.paymentFailed")}</AlertDescription>
                  </AlertContent>
                  <AlertActions>
                    <Button
                      type="button"
                      size="sm"
                      disabled={props.store.state.pending !== null}
                      onClick={() => void props.store.openPortal({ flow: "manage" })}
                    >
                      {t("billing.action.updatePayment")}
                    </Button>
                  </AlertActions>
                </Alert>
              </Show>
              <div class="billing-toolbar">
                <Text variant="caption" tone="muted">
                  {t("billing.servers.title")}
                </Text>
                <Show when={state().hasCustomer}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={props.store.state.pending !== null}
                    aria-busy={managing() ? "true" : undefined}
                    onClick={() => void props.store.openPortal({ flow: "manage" })}
                  >
                    <CreditCard aria-hidden="true" />
                    {managing() ? t("billing.opening") : t("billing.manage")}
                  </Button>
                </Show>
              </div>
              <Show
                when={state().servers.length > 0}
                fallback={
                  <div class="billing-empty">
                    <Text tone="muted">{t("billing.empty")}</Text>
                  </div>
                }
              >
                <ItemGroup class="billing-servers" role="list">
                  <For each={state().servers}>
                    {(server) => <BillingServerRow server={server} store={props.store} />}
                  </For>
                </ItemGroup>
              </Show>
            </>
          )}
        </Match>
        <Match when>
          <div class="billing-loading">
            <Spinner label={t("billing.loading")} />
          </div>
        </Match>
      </Switch>
    </div>
  );
}

function BillingError(props: { message: string; store: BillingStore }): JSX.Element {
  const { t } = useText();
  return (
    <Alert tone="danger" role="alert">
      <AlertIcon>
        <TriangleAlert aria-hidden="true" />
      </AlertIcon>
      <AlertContent>
        <AlertDescription>{props.message}</AlertDescription>
      </AlertContent>
      <AlertActions>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.store.state.loading}
          onClick={() => void props.store.load()}
        >
          {t("common.retry")}
        </Button>
      </AlertActions>
    </Alert>
  );
}

function BillingServerRow(props: { server: BillingServerPlan; store: BillingStore }): JSX.Element {
  const { t, format } = useText();
  const name = () => props.server.serverName ?? t("billing.server.unnamed");
  const storageGb = () => BILLING_PLANS.find((plan) => plan.id === props.server.plan)?.storageGb ?? 0;
  const badge = () => STATUS_BADGE[props.server.status];
  // The price of one period, or only the interval when Stripe gave no fixed amount.
  const price = () => {
    const { amount, currency, interval } = props.server;
    if (amount === null) return t(INTERVAL_LABEL[interval]);
    const value = format.number(amount / 100, {
      style: "currency",
      currency: currency.toUpperCase(),
      // All plan currencies have cents. A whole amount shows no cents.
      minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    });
    return interval === "month"
      ? t("billing.server.price.month", { amount: value })
      : t("billing.server.price.year", { amount: value });
  };
  const periodEnd = () => {
    const end = props.server.currentPeriodEnd;
    if (end === null) return null;
    const date = format.date(end, { dateStyle: "long" });
    return props.server.cancelAtPeriodEnd ? t("billing.server.ends", { date }) : t("billing.server.renews", { date });
  };
  const opening = () => {
    const pending = props.store.state.pending;
    return (
      pending === billingActionKey({ flow: "update", subscriptionId: props.server.subscriptionId }) ||
      pending === billingActionKey({ flow: "cancel", subscriptionId: props.server.subscriptionId })
    );
  };
  const open = (request: BillingPortalRequest) => void props.store.openPortal(request);

  return (
    <Item class="billing-server" role="listitem">
      <ItemMedia>
        <ServerGradientLogo class="billing-server-logo" seed={props.server.serverId ?? props.server.subscriptionId} />
      </ItemMedia>
      <ItemContent>
        <div class="billing-server-title">
          <ItemTitle>{name()}</ItemTitle>
          <Show when={badge()}>{(item) => <Badge variant={item().variant}>{t(item().text)}</Badge>}</Show>
        </div>
        <ItemDescription>
          {t("billing.server.summary", {
            plan: t(PLAN_NAME[props.server.plan]),
            size: format.number(storageGb()),
          })}
        </ItemDescription>
        <Show when={periodEnd()}>{(line) => <ItemDescription>{line()}</ItemDescription>}</Show>
      </ItemContent>
      <ItemActions>
        <Text as="span" variant="label" class="billing-server-price">
          {price()}
        </Text>
        <Show when={opening()}>
          <Spinner size="sm" label={t("billing.opening")} />
        </Show>
        <DropdownMenu.Root placement="bottom-end" gutter={4}>
          <DropdownMenu.Trigger
            class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label={t("billing.action.menu", { server: name() })}
            disabled={props.store.state.pending !== null}
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => open({ flow: "update", subscriptionId: props.server.subscriptionId })}>
                <SlidersHorizontal aria-hidden="true" />
                {t("billing.action.change")}
              </DropdownMenu.Item>
              <Show when={paymentFailed(props.server)}>
                <DropdownMenu.Item onSelect={() => open({ flow: "manage" })}>
                  <CreditCard aria-hidden="true" />
                  {t("billing.action.updatePayment")}
                </DropdownMenu.Item>
              </Show>
              <Show
                when={!props.server.cancelAtPeriodEnd}
                fallback={
                  // Stripe has no Portal flow that renews one plan. The account Portal shows a Renew button.
                  <DropdownMenu.Item onSelect={() => open({ flow: "manage" })}>
                    <RotateCcw aria-hidden="true" />
                    {t("billing.action.renew")}
                  </DropdownMenu.Item>
                }
              >
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  class="ui-action-menu-danger"
                  onSelect={() => open({ flow: "cancel", subscriptionId: props.server.subscriptionId })}
                >
                  <OctagonX aria-hidden="true" />
                  {t("billing.action.cancel")}
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </ItemActions>
    </Item>
  );
}
