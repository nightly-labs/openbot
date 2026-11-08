import { Badge, buttonVariants, Check, ExternalLink } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

/**
 * The chat card after the OpenBot team got the user's feedback: a thank-you, the title, and a link to
 * the public issue. It comes in where the offer card was, with a short entrance.
 */
export function FeedbackSentCard(props: {
  title: string;
  number: number;
  url: string;
  /** Opens the issue outside the app. Absent, the link opens a new browser tab. */
  onOpenLink?: ((url: string) => void) | undefined;
}) {
  const { t } = useText();
  return (
    <section
      class="approval-card conversation-interaction-card feedback-sent"
      aria-label={t("chat.feedbackSent.title")}
    >
      <header class="conversation-interaction-header">
        <strong>{t("chat.feedbackSent.title")}</strong>
        <Badge variant="success-light" class="conversation-interaction-status feedback-sent-badge">
          <Check data-icon="inline-start" aria-hidden="true" />
          {t("chat.feedbackSent.badge")}
        </Badge>
      </header>
      <p class="feedback-sent-body">{t("chat.feedbackSent.body")}</p>
      <footer class="feedback-sent-footer">
        <Show when={props.title}>{(title) => <span class="feedback-sent-title">{title()}</span>}</Show>
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
      </footer>
    </section>
  );
}
