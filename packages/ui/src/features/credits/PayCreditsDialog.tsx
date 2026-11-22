import type { BillingCurrency } from "@openbot/contracts/billing";
import { chargesVat, isWithdrawalConsumer, VAT_TAX_RATE, vatAmount } from "@openbot/contracts/billing-details";
import { type CreditStop, creditRegularPrice, creditStopPrice, creditTier } from "@openbot/contracts/credits";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  Checkbox,
  Dialog,
  IconButton,
  TriangleAlert,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createUniqueId, Show, untrack } from "solid-js";
import { useText } from "../../text";
import {
  type BillingDetailsCalls,
  BillingDetailsFields,
  billingDetailsRequest,
  createBillingDetailsForm,
} from "../billing/BillingDetailsFields";
import { formatMinorMoney } from "../billing/money";
import { CreditIcon } from "./CreditIcon";
import { type CreditTarget, CreditTargetLogo } from "./CreditTargetSelect";

export interface CreditConsent {
  earlyStart: boolean;
}

export interface PayCreditsDialogProps {
  stop: CreditStop;
  currency: BillingCurrency;
  target: CreditTarget;
  pending: boolean;
  billingDetails: BillingDetailsCalls | undefined;
  onConfirm: (consent: CreditConsent) => void;
  onClose: () => void;
}

export function PayCreditsDialog(props: PayCreditsDialogProps): JSX.Element {
  const { t, format } = useText();
  const consentId = `credit-confirm-early-start-${createUniqueId()}`;
  const details = createBillingDetailsForm(() => props.billingDetails);
  const [earlyStart, setEarlyStart] = createSignal(false);
  const askDetails = createMemo(
    () => props.billingDetails !== undefined && details.known() && untrack(details.saved)?.country == null,
  );
  const request = () => billingDetailsRequest(details.draft());
  const detailsMissing = () => props.billingDetails !== undefined && request() === null;
  const busy = () => props.pending || details.saving();
  const money = (minor: number) => formatMinorMoney(format, minor, props.currency);
  const price = () => creditStopPrice(props.stop, props.currency);
  const regular = () => Math.max(price(), creditRegularPrice(props.stop, props.currency));
  const discount = () => regular() - price();
  const percent = () => props.stop.discount / 100;
  const vat = () => {
    const chosen = request();
    return chosen && chargesVat(chosen.country, chosen.vatId ?? null) ? vatAmount(price()) : 0;
  };
  const total = () => price() + vat();
  const earlyStartAsked = () => {
    const chosen = request();
    return chosen !== null && isWithdrawalConsumer({ country: chosen.country, vatId: chosen.vatId ?? null });
  };
  const blocked = () => busy() || detailsMissing() || (earlyStartAsked() && !earlyStart());
  const close = () => {
    if (!busy()) props.onClose();
  };
  const confirm = async () => {
    if (blocked()) return;
    if (!(await details.save())) return;
    props.onConfirm({ earlyStart: earlyStartAsked() && earlyStart() });
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content
            as="section"
            class="hosted-upsell-modal credit-confirm-modal"
            data-tier={creditTier(props.stop)}
          >
            <IconButton
              class="credit-confirm-close"
              label={t("common.close")}
              variant="ghost"
              disabled={busy()}
              onClick={close}
            >
              <X />
            </IconButton>
            <div class="credit-confirm-hero">
              <span class="credit-confirm-badge">
                <CreditIcon class="credit-confirm-icon" />
              </span>
              <Dialog.Title as="h2" class="hosted-upsell-modal-title">
                {t("billing.credits.buy")}
              </Dialog.Title>
            </div>
            <dl class="credit-confirm-summary">
              <div class="credit-confirm-row">
                <dt>
                  {t("billing.credits.amount", {
                    count: props.stop.credits,
                    amount: format.number(props.stop.credits),
                  })}
                </dt>
                <dd>{money(regular())}</dd>
              </div>
              <Show when={discount() > 0}>
                <div class="credit-confirm-row credit-confirm-discount">
                  <dt>
                    {t("billing.credits.discount")}
                    <span class="credit-chip credit-chip-save">
                      {t("billing.credits.save", { percent: format.percent(percent()) })}
                    </span>
                  </dt>
                  <dd>{t("billing.credits.discountAmount", { amount: money(discount()) })}</dd>
                </div>
              </Show>
              <div class="credit-confirm-row">
                <dt>{t("billing.credits.for")}</dt>
                <dd class="credit-confirm-target">
                  <CreditTargetLogo target={props.target} />
                  <span class="credit-confirm-target-name">{props.target.name}</span>
                </dd>
              </div>
              <Show when={vat() > 0}>
                <div class="credit-confirm-row">
                  <dt>{t("billing.credits.vat", { percent: format.percent(VAT_TAX_RATE.percentage / 100) })}</dt>
                  <dd>{t("billing.credits.vatAmount", { amount: money(vat()) })}</dd>
                </div>
              </Show>
              <div class="credit-confirm-row credit-confirm-total">
                <dt>{t("billing.credits.total")}</dt>
                <dd>{money(total())}</dd>
              </div>
            </dl>
            <Show when={askDetails()}>
              <BillingDetailsFields value={details.draft()} disabled={busy()} onChange={details.edit} />
            </Show>
            <Show when={earlyStartAsked()}>
              <div class="hosted-pricing-consent">
                <Checkbox
                  id={consentId}
                  checked={earlyStart()}
                  disabled={busy()}
                  onChange={(event) => setEarlyStart(event.currentTarget.checked)}
                />
                <label for={consentId}>{t("billing.credits.earlyStart")}</label>
              </div>
            </Show>
            <Show when={details.error()}>
              {(message) => (
                <Alert tone="danger" report={false} role="alert">
                  <AlertIcon>
                    <TriangleAlert />
                  </AlertIcon>
                  <AlertContent>
                    <AlertDescription>{message()}</AlertDescription>
                  </AlertContent>
                </Alert>
              )}
            </Show>
            <Button
              class="hosted-pricing-pill credit-confirm-pay"
              loading={busy()}
              disabled={blocked()}
              onClick={() => void confirm()}
            >
              {t("billing.credits.confirmPay", { amount: money(total()) })}
            </Button>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
