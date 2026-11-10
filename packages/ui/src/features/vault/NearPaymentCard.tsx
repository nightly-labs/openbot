/**
 * A payment from the NEAR Intents wallet that waits for the owner in the chat. It takes the place of
 * the approval card of the same request: Reject and Approve answer the approval, and "Always allow"
 * lets agents pay the domain without asking, up to a daily limit, then approves this payment.
 */

import type { NearPendingPayment, NearWalletStatus } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { Button, toast } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { UiBlockCard } from "../conversation/ui-blocks/UiBlockCard";
import { NearDomainDialog } from "./near-wallet-dialogs";
import { type NearWalletActions, SiteIcon } from "./near-wallet-parts";

export interface NearPaymentCardProps {
  payment: NearPendingPayment;
  status: NearWalletStatus;
  actions: NearWalletActions;
  /** Answer the approval of this payment, as the approval card does. */
  onApprove: () => Promise<boolean>;
  onReject: () => Promise<boolean>;
}

export function NearPaymentCard(props: NearPaymentCardProps) {
  const { t, errorMessage } = useText();
  const [submitting, setSubmitting] = createSignal(false);
  const [allowing, setAllowing] = createSignal(false);
  const waiting = () => {
    const signing = props.status.signing;
    if (!signing) return false;
    return signing.requestId === props.payment.requestId || signing.action === "auto-pay";
  };
  // A payment with no price always asks, and one over the limit is already on an allowed domain.
  const canAllow = () => !props.payment.overLimit && props.payment.amountUsd !== null;
  const subtitle = () =>
    [props.payment.domain, props.payment.reason, props.payment.overLimit && t("vault.near.overLimit")]
      .filter(Boolean)
      .join(" · ");

  async function answer(vote: () => Promise<boolean>) {
    if (submitting()) return;
    setSubmitting(true);
    try {
      if (!(await vote())) setSubmitting(false);
    } catch (error) {
      toast.error(errorMessage(error, t("prompt.approval.answerFailed")), {
        report: { operation: "turn", source: "system", cause_code: classifyFailure(error) },
      });
      setSubmitting(false);
    }
  }

  /** Allows the domain, then approves this payment. A failure stays in the dialog. */
  async function allow(dailyUsd: number): Promise<NearWalletStatus> {
    const status = await props.actions.allowPayment({ requestId: props.payment.requestId, dailyUsd });
    if (status.error === null) void answer(props.onApprove);
    return status;
  }

  const icon = () => <SiteIcon domain={props.payment.domain} class="ui-block-icon" />;
  const signingButtons = () => (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => void props.actions.cancelSigning()}>
        {t("common.cancel")}
      </Button>
      <Button type="button" size="sm" onClick={() => void props.actions.openSigning()}>
        {t("vault.near.openAgain")}
      </Button>
    </>
  );
  const buttons = () => (
    <Show when={!waiting()} fallback={signingButtons()}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={submitting()}
        onClick={() => void answer(props.onReject)}
      >
        {t("vault.near.reject")}
      </Button>
      <Show when={canAllow()}>
        <Button type="button" variant="secondary" size="sm" disabled={submitting()} onClick={() => setAllowing(true)}>
          {t("prompt.approval.alwaysAllow")}
        </Button>
      </Show>
      <Button type="button" size="sm" disabled={submitting()} onClick={() => void answer(props.onApprove)}>
        {t("vault.near.approve")}
      </Button>
    </Show>
  );

  return (
    <>
      <UiBlockCard
        class="near-chat-card"
        status="pending"
        icon={icon()}
        title={t("vault.near.payment", { amount: props.payment.amount, symbol: props.payment.symbol })}
        subtitle={subtitle()}
        busy={submitting() && !waiting()}
        waiting={waiting()}
        waitingLabel={t("vault.near.waitingShort")}
        inlineActions
        actions={buttons()}
      />
      <Show when={allowing()}>
        <NearDomainDialog
          status={props.status}
          actions={props.actions}
          mode="always"
          domain={props.payment.domain}
          min={props.payment.amountUsd ?? 0}
          onClose={() => setAllowing(false)}
          onSave={allow}
        />
      </Show>
    </>
  );
}
