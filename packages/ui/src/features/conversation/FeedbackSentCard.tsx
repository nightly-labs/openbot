import type { WithdrawFeedbackStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Badge, Button, buttonVariants, Check, ExternalLink, Pencil, Trash2 } from "@openbot/ui";
import { createSignal, createUniqueId, Show } from "solid-js";
import { useText } from "../../text";

const WITHDRAW_FAILURES = {
  signedOut: "chat.feedbackSent.removeSignedOut",
  notYours: "chat.feedbackSent.removeNotYours",
  unavailable: "chat.feedbackSent.removeUnavailable",
  limited: "chat.feedbackSent.removeLimited",
  notFound: "chat.feedbackSent.removeNotFound",
  moved: "chat.feedbackSent.removeMoved",
} as const satisfies Record<Exclude<WithdrawFeedbackStatus, "withdrawn">, AppTextKey>;

type Step = "closed" | "choosing" | "confirming";

export function FeedbackSentCard(props: {
  title: string;
  number: number;
  url: string;
  withdrawn?: boolean | undefined;
  onOpenLink?: ((url: string) => void) | undefined;
  onFix?: (() => void) | undefined;
  onWithdraw?: (() => Promise<WithdrawFeedbackStatus>) | undefined;
  onAskRemove?: (() => void) | undefined;
}) {
  const { t } = useText();
  const panelId = createUniqueId();
  const [step, setStep] = createSignal<Step>("closed");
  const [removing, setRemoving] = createSignal(false);
  const [removed, setRemoved] = createSignal(false);
  const [composerFilled, setComposerFilled] = createSignal(false);
  const [failure, setFailure] = createSignal<AppTextKey | null>(null);
  const withdrawn = () => props.withdrawn === true || removed();
  const canChange = () => props.onFix !== undefined && (props.onWithdraw ?? props.onAskRemove) !== undefined;

  const fillComposer = (fill: () => void) => {
    fill();
    setStep("closed");
    setComposerFilled(true);
  };

  const chooseRemove = () => {
    setFailure(null);
    if (props.onWithdraw) setStep("confirming");
    else if (props.onAskRemove) fillComposer(props.onAskRemove);
  };

  const remove = async () => {
    const withdraw = props.onWithdraw;
    if (!withdraw || removing()) return;
    setRemoving(true);
    setFailure(null);
    try {
      const status = await withdraw();
      if (status === "withdrawn") {
        setRemoved(true);
        setStep("closed");
      } else setFailure(WITHDRAW_FAILURES[status]);
    } catch {
      setFailure("chat.feedbackSent.removeFailed");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section
      class="approval-card conversation-interaction-card feedback-sent"
      aria-label={t(withdrawn() ? "chat.feedbackWithdrawn.title" : "chat.feedbackSent.title")}
    >
      <header class="conversation-interaction-header">
        <strong>{t(withdrawn() ? "chat.feedbackWithdrawn.title" : "chat.feedbackSent.title")}</strong>
        <Show
          when={withdrawn()}
          fallback={
            <Badge variant="success-light" class="conversation-interaction-status feedback-sent-badge">
              <Check data-icon="inline-start" aria-hidden="true" />
              {t("chat.feedbackSent.badge")}
            </Badge>
          }
        >
          <Badge variant="secondary" class="conversation-interaction-status">
            {t("chat.feedbackWithdrawn.badge")}
          </Badge>
        </Show>
      </header>
      <p class="feedback-sent-body">{t(withdrawn() ? "chat.feedbackWithdrawn.body" : "chat.feedbackSent.body")}</p>
      <Show when={composerFilled() && !withdrawn()}>
        <p class="feedback-sent-note" role="status">
          {t("chat.feedbackSent.composerFilled")}
        </p>
      </Show>
      <Show when={step() !== "closed" && !withdrawn()}>
        <div class="feedback-sent-panel" id={panelId}>
          <Show
            when={step() === "confirming"}
            fallback={
              <>
                <Button
                  variant="ghost"
                  class="feedback-sent-choice"
                  onClick={() => {
                    props.onFix?.();
                    setStep("closed");
                  }}
                >
                  <Pencil aria-hidden="true" />
                  <span class="feedback-sent-choice-text">
                    <span class="feedback-sent-choice-title">{t("chat.feedbackSent.fixChoice")}</span>
                    <span class="feedback-sent-choice-hint">{t("chat.feedbackSent.fixChoiceHint")}</span>
                  </span>
                </Button>
                <Button variant="ghost" class="feedback-sent-choice" onClick={chooseRemove}>
                  <Trash2 aria-hidden="true" />
                  <span class="feedback-sent-choice-text">
                    <span class="feedback-sent-choice-title">{t("chat.feedbackSent.removeChoice")}</span>
                    <span class="feedback-sent-choice-hint">{t("chat.feedbackSent.removeChoiceHint")}</span>
                  </span>
                </Button>
              </>
            }
          >
            <div class="feedback-sent-confirm">
              <p>{t("chat.feedbackSent.removeConfirm")}</p>
              <Show when={failure()}>
                {(key) => (
                  <p class="feedback-sent-error" role="alert">
                    {t(key())}
                  </p>
                )}
              </Show>
              <div class="feedback-sent-confirm-actions">
                <Button variant="ghost" size="sm" disabled={removing()} onClick={() => setStep("choosing")}>
                  {t("chat.feedbackSent.keep")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  loading={removing()}
                  loadingLabel={t("chat.feedbackSent.removing")}
                  onClick={() => void remove()}
                >
                  {t("chat.feedbackSent.remove")}
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </Show>
      <footer class="feedback-sent-footer">
        <Show when={props.title}>{(title) => <span class="feedback-sent-title">{title()}</span>}</Show>
        <Show when={!withdrawn()}>
          <span class="feedback-sent-actions">
            <Show when={canChange()}>
              <Button
                variant="ghost"
                size="sm"
                class="feedback-sent-change"
                aria-expanded={step() === "closed" ? "false" : "true"}
                aria-controls={step() === "closed" ? undefined : panelId}
                disabled={removing()}
                onClick={() => {
                  setFailure(null);
                  setComposerFilled(false);
                  setStep(step() === "closed" ? "choosing" : "closed");
                }}
              >
                {t("chat.feedbackSent.fixOrRemove")}
              </Button>
            </Show>
            <a
              class={buttonVariants({ variant: "outline", size: "sm" })}
              href={props.url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!props.onOpenLink) return;
                event.preventDefault();
                props.onOpenLink(props.url);
              }}
              aria-label={t("chat.feedbackSent.openNamed", { number: String(props.number) })}
            >
              #{props.number}
              <ExternalLink data-icon="inline-end" aria-hidden="true" />
            </a>
          </span>
        </Show>
      </footer>
    </section>
  );
}
