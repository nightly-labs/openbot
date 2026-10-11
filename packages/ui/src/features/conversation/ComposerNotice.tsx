import { type AgentProviderId, agentProviderName } from "@openbot/contracts/agent-providers";
import type { AppFormat } from "@openbot/i18n";
import { Button, ErrorReference, TriangleAlert } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { CloseIcon } from "./ConversationIcons";

/**
 * The shared slab every composer notice uses: a warning-toned card in the queue's shape, above the
 * input and under the queue, because the user reads that column top to bottom before they send.
 *
 * `tone` is `danger` for errors and spent plan windows, and `warning` for account setup notices.
 *
 * `onDismiss` decides the rest. A notice the user can clear gets the close button, Escape, and
 * `role="alert"`, because a state the user did not ask for has to announce itself. The states they
 * walked into, such as a signed-out provider, stay until they are resolved, so they
 * only report. `title` is optional: a failure the provider already stated in a sentence gains
 * nothing from a label that repeats the word "error" above it.
 */
export function ComposerNotice(props: {
  tone?: "warning" | "danger";
  title?: string;
  body: string;
  /** The code of the failure the body states. */
  reference?: string | null | undefined;
  action?: JSX.Element;
  conversationKey?: string | null;
  onDismiss?: () => void;
}) {
  const { t } = useText();
  return (
    <Show
      when={props.onDismiss}
      fallback={
        <div
          class="composer-notice"
          data-tone={props.tone ?? "warning"}
          data-conversation-key={props.conversationKey ?? undefined}
          role="status"
        >
          <NoticeContent title={props.title} body={props.body} reference={props.reference} action={props.action} />
        </div>
      }
    >
      {(dismiss) => (
        <div
          class="composer-notice"
          data-tone={props.tone ?? "warning"}
          data-conversation-key={props.conversationKey ?? undefined}
          role="alert"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            dismiss()();
          }}
        >
          <NoticeContent title={props.title} body={props.body} reference={props.reference} action={props.action} />
          <Button
            variant="ghost"
            type="button"
            size="sm"
            class="composer-notice-dismiss"
            aria-label={t("composer.notice.dismiss")}
            data-cuelume-tap="close"
            onClick={() => dismiss()()}
          >
            <CloseIcon />
          </Button>
        </div>
      )}
    </Show>
  );
}

/** The icon, copy and optional action the card carries, whichever role announces it. */
function NoticeContent(props: {
  title?: string;
  body: string;
  reference?: string | null | undefined;
  action?: JSX.Element;
}) {
  return (
    <>
      <TriangleAlert class="composer-notice-icon" aria-hidden="true" />
      <div class="composer-notice-copy">
        <Show when={props.title}>{(title) => <strong>{title()}</strong>}</Show>
        <p>{props.body}</p>
        <ErrorReference reference={props.reference} />
      </div>
      <Show when={props.action}>{props.action}</Show>
    </>
  );
}

/**
 * The signed-out provider, stated before the user sends rather than after the send fails.
 *
 * The wording matches the provider picker's `sign-in-required` label on purpose - a user who has
 * seen "Sign in required" in the model picker should not have to work out that this is the same
 * state.
 *
 * There is no retry action here. The composer keeps the draft across a sign-in, so sending again is
 * the retry, and a button that re-sent silently would be a second send the user did not ask for.
 */
export function ComposerSignInNotice(props: {
  provider: AgentProviderId;
  onSignIn: (provider: AgentProviderId) => void | Promise<void>;
  signingIn?: boolean;
  onShown?: () => void;
}) {
  const { t } = useText();
  createEffect(
    () => props.provider,
    () => props.onShown?.(),
  );
  const providerName = () => agentProviderName(props.provider);
  /**
   * Opening the sign-in guide is a round trip to the main process, and the provider only reports
   * `connecting` once it answers. Without a local pending flag the button looks unpressed for that
   * whole gap, so the user presses it again and opens a second guide.
   */
  const [starting, setStarting] = createSignal(false);
  const busy = () => starting() || Boolean(props.signingIn);
  const signIn = async () => {
    if (busy()) return;
    setStarting(true);
    try {
      await props.onSignIn(props.provider);
    } finally {
      // A failed sign-in leaves the notice in place, so the button has to become pressable again.
      setStarting(false);
    }
  };
  return (
    <ComposerNotice
      title={t("composer.signIn.title")}
      body={t("composer.signIn.body", { provider: providerName() })}
      action={
        <Button
          variant="outline"
          size="sm"
          type="button"
          loading={busy()}
          loadingLabel={t("composer.signIn.pending")}
          aria-label={t("composer.signIn.label", { provider: providerName() })}
          onClick={() => void signIn()}
        >
          {t("composer.signIn.action")}
        </Button>
      }
    />
  );
}

export function ComposerUpdateNotice(props: {
  provider: AgentProviderId;
  onUpdate?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  updating?: boolean;
}) {
  const { t } = useText();
  const [starting, setStarting] = createSignal(false);
  const busy = () => starting() || Boolean(props.updating);
  const update = async () => {
    if (busy()) return;
    setStarting(true);
    try {
      await props.onUpdate?.(props.provider);
    } finally {
      setStarting(false);
    }
  };
  return (
    <ComposerNotice
      body={
        props.onUpdate
          ? t("composer.update.body", { provider: agentProviderName(props.provider) })
          : t("composer.update.manual", { provider: agentProviderName(props.provider) })
      }
      action={
        <Show when={props.onUpdate}>
          <Button
            variant="outline"
            size="sm"
            type="button"
            loading={busy()}
            loadingLabel={t("composer.update.pending")}
            onClick={() => void update()}
          >
            {t("composer.update.action")}
          </Button>
        </Show>
      }
    />
  );
}

/** The reset moment, in the reader's own locale. A window with no reported reset gets no sentence. */
function formatUsageReset(resetsAt: number | null | undefined, format: AppFormat): string | null {
  if (resetsAt === null || resetsAt === undefined) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return format.date(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A spent plan window can coexist with paid credits. Dismissing the notice only hides the reading;
 * the provider still decides whether to accept the next turn.
 */
export function ComposerUsageLimitNotice(props: {
  provider: AgentProviderId;
  resetsAt?: number | null;
  onShown?: () => void;
  onDismiss: () => void;
}) {
  const { t, format } = useText();
  createEffect(
    () => props.provider,
    () => props.onShown?.(),
  );
  const resetAt = () => formatUsageReset(props.resetsAt, format);
  const body = () => {
    const provider = agentProviderName(props.provider);
    const reset = resetAt();
    return reset
      ? t("composer.usageLimit.resets", { provider, reset })
      : t("composer.usageLimit.selectModel", { provider });
  };
  return (
    <ComposerNotice tone="danger" title={t("composer.usageLimit.title")} body={body()} onDismiss={props.onDismiss} />
  );
}
