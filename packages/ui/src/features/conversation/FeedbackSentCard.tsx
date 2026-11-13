import type { WithdrawFeedbackStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Badge, Button, buttonVariants, Check, ExternalLink, Pencil, Trash2 } from "@openbot/ui";
import { createSignal, createUniqueId, Show } from "solid-js";
import { useText } from "../../text";

/** What the card says when a removal does not end with the report off GitHub. */
const WITHDRAW_FAILURES = {
  signedOut: "chat.feedbackSent.removeSignedOut",
  notYours: "chat.feedbackSent.removeNotYours",
  unavailable: "chat.feedbackSent.removeUnavailable",
  limited: "chat.feedbackSent.removeLimited",
  notFound: "chat.feedbackSent.removeNotFound",
} as const satisfies Record<Exclude<WithdrawFeedbackStatus, "withdrawn">, AppTextKey>;

type Step = "closed" | "choosing" | "confirming";

/**
 * The chat card after the OpenBot team got the user's feedback: a thank-you, the title, and a link to
 * the public issue. It comes in where the offer card was, with a short entrance.
 *
 * With `onFix`, Fix or remove offers two choices. A corrected report goes through the agent: the
 * composer gets the request, and the user completes and sends it. Remove asks in the card first,
 * because it cannot be undone, then calls `onWithdraw`. Without `onWithdraw`, such as for a joined
 * server, Remove puts a request for the agent in the composer too. A removed report shows a Removed
 * card with no link.
 */
export function FeedbackSentCard(props: {
  title: string;
  number: number;
  url: string;
  /** True after the user took the report off GitHub. */
  withdrawn?: boolean | undefined;
  /** Opens the issue outside the app. Absent, the link opens a new browser tab. */
  onOpenLink?: ((url: string) => void) | undefined;
  /** Puts a request for a corrected report in the composer. Absent, the card offers no change. */
  onFix?: (() => void) | undefined;
  /** Takes the report off GitHub. Absent, Remove puts a request for the agent in the composer. */
  onWithdraw?: (() => Promise<WithdrawFeedbackStatus>) | undefined;
  /** Puts a request to remove the report in the composer, where this client cannot remove it. */
  onAskRemove?: (() => void) | undefined;
}) {
  const { t } = useText();
  const panelId = createUniqueId();
  const [step, setStep] = createSignal<Step>("closed");
  const [removing, setRemoving] = createSignal(false);
  const [removed, setRemoved] = createSignal(false);
  const [composerFilled, setComposerFilled] = createSignal(false);
  const [failure, setFailure] = createSignal<AppTextKey | null>(null);
  // The chat update comes after the answer, so the card shows the removal at once.
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
                  onClick={() => props.onFix && fillComposer(props.onFix)}
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
