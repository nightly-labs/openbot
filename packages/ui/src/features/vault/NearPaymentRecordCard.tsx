import type { ConversationNearPayment, NearPaymentState } from "@openbot/contracts/ipc";
import type { UiBlockStatus } from "@openbot/contracts/ui-blocks";
import type { AppMessages } from "@openbot/i18n";
import { buttonVariants, CircleAlert, ExternalLink, LabelTooltip, LabelTooltipTrigger } from "@openbot/ui";
import { createEffect, createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { UiBlockCard } from "../conversation/ui-blocks/UiBlockCard";
import { SiteIcon } from "./near-wallet-parts";

export interface NearPaymentRecordCardProps {
  payment: ConversationNearPayment;
  onOpenLink?: ((url: string) => void) | undefined;
}

const TITLE = {
  sending: "vault.near.paying",
  paid: "vault.near.paid",
  rejected: "vault.near.notPaid",
  failed: "vault.near.notPaid",
  uncertain: "vault.near.paying",
} as const satisfies Record<NearPaymentState, keyof AppMessages>;

const CARD_STATUS = {
  sending: "pending",
  paid: "answered",
  rejected: "closed",
  failed: "closed",
  uncertain: "closed",
} as const satisfies Record<NearPaymentState, UiBlockStatus>;

export function nearTransactionUrl(hash: string): string {
  return `https://nearblocks.io/txns/${encodeURIComponent(hash)}`;
}

function PaymentSubtitle(props: { text: string }) {
  const [element, setElement] = createSignal<HTMLElement>();
  const [cut, setCut] = createSignal(false);
  createEffect(element, (target) => {
    if (!target) return;
    const observer = new ResizeObserver(() => setCut(target.scrollWidth > target.clientWidth));
    observer.observe(target);
    return () => observer.disconnect();
  });
  return (
    <LabelTooltip content={props.text} disabled={!cut()}>
      <LabelTooltipTrigger as="span" class="near-payment-subtitle" ref={setElement}>
        {props.text}
      </LabelTooltipTrigger>
    </LabelTooltip>
  );
}

export function NearPaymentRecordCard(props: NearPaymentRecordCardProps) {
  const { t, sourceText } = useText();
  const outcome = () => {
    const state = props.payment.state;
    if (state === "paid") return t(props.payment.automatic ? "vault.near.automatic" : "vault.near.approved");
    if (state === "rejected") return t("vault.near.rejected");
    if (state === "failed") return t("vault.near.paymentFailed");
    if (state === "uncertain") return t("vault.near.notConfirmed");
    return undefined;
  };
  const link = () => {
    const hash = props.payment.transactionHash;
    return props.payment.state === "paid" && hash ? nearTransactionUrl(hash) : null;
  };
  const note = () => {
    const detail = props.payment.detail;
    return props.payment.state === "paid" ? null : detail && sourceText(detail);
  };
  return (
    <UiBlockCard
      class="near-chat-card near-payment-record"
      status={CARD_STATUS[props.payment.state]}
      outcome={outcome()}
      outcomeBadge
      waiting={props.payment.state === "sending"}
      waitingLabel={t("vault.near.sending")}
      outcomeIcon={
        <Show when={props.payment.state === "uncertain"}>
          <CircleAlert class="near-payment-alert" data-icon="inline-start" aria-hidden="true" />
        </Show>
      }
      icon={<SiteIcon domain={props.payment.domain} class="ui-block-icon" />}
      title={
        <span class="near-payment-title">
          {t(TITLE[props.payment.state], { amount: `${props.payment.amount} ${props.payment.symbol}` })}
          <Show when={link()}>
            {(url) => (
              <a
                class={`${buttonVariants({ variant: "link", size: "sm" })} near-payment-link`}
                href={url()}
                target="_blank"
                rel="noreferrer"
                aria-label={t("vault.near.openTransaction")}
                onClick={(event) => {
                  if (!props.onOpenLink) return;
                  event.preventDefault();
                  props.onOpenLink(url());
                }}
              >
                <ExternalLink aria-hidden="true" />
              </a>
            )}
          </Show>
        </span>
      }
      subtitle={<PaymentSubtitle text={`${props.payment.domain} · ${props.payment.reason}`} />}
    >
      <Show when={note()}>{(text) => <p class="near-payment-note">{text()}</p>}</Show>
    </UiBlockCard>
  );
}
