import { type AgentProviderId, agentProviderName } from "@openbot/contracts/agent-providers";
import { Button, TriangleAlert } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { CloseIcon } from "./ConversationIcons";

/**
 * The shared slab every composer notice uses: a warning-toned card in the queue's shape, above the
 * input and under the queue, because the user reads that column top to bottom before they send.
 *
 * `tone` is the only difference between the states. It is `danger` when the user cannot send at all
 * and the wait is not in their hands, and `warning` when one press puts the state right.
 *
 * `onDismiss` decides the rest. A notice the user can clear gets the close button, Escape, and
 * `role="alert"`, because a state the user did not ask for has to announce itself. The states they
 * walked into - a signed-out provider, a spent plan window - stay until they are resolved, so they
 * only report. `title` is optional: a failure the provider already stated in a sentence gains
 * nothing from a label that repeats the word "error" above it.
 */
export function ComposerNotice(props: {
  tone?: "warning" | "danger";
  title?: string;
  body: string;
  action?: JSX.Element;
  conversationKey?: string | null;
  onDismiss?: () => void;
}) {
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
          <NoticeContent title={props.title} body={props.body} action={props.action} />
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
          <NoticeContent title={props.title} body={props.body} action={props.action} />
          <Button
            variant="ghost"
            type="button"
            size="sm"
            class="composer-notice-dismiss"
            aria-label="Dismiss error"
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
function NoticeContent(props: { title?: string; body: string; action?: JSX.Element }) {
  return (
    <>
      <TriangleAlert class="composer-notice-icon" aria-hidden="true" />
      <div class="composer-notice-copy">
        <Show when={props.title}>{(title) => <strong>{title()}</strong>}</Show>
        <p>{props.body}</p>
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
}) {
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
      title="Sign in required"
      body={`Sign in to ${providerName()} to send messages.`}
      action={
        <Button
          variant="outline"
          size="sm"
          type="button"
          loading={busy()}
          loadingLabel="Signing in…"
          aria-label={`Sign in to ${providerName()}`}
          onClick={() => void signIn()}
        >
          Sign in
        </Button>
      }
    />
  );
}

/** The reset moment, in the reader's own locale. A window with no reported reset gets no sentence. */
function formatUsageReset(resetsAt: number | null | undefined): string | null {
  if (resetsAt === null || resetsAt === undefined) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * The plan limit, used up: the provider accepts no more turns on this model until its window resets.
 *
 * It carries no button on purpose. Nothing the user presses here gives them more quota - only time
 * does, or a different model, and the model picker under this notice already does that. So the card
 * says when the limit resets instead, which is the one fact the user needs to plan around it.
 */
export function ComposerUsageLimitNotice(props: { provider: AgentProviderId; resetsAt?: number | null }) {
  const resetAt = () => formatUsageReset(props.resetsAt);
  const body = () => {
    const providerName = agentProviderName(props.provider);
    const reset = resetAt();
    return reset
      ? `You used all of your ${providerName} limit. It resets ${reset}.`
      : `You used all of your ${providerName} limit. Select a different model to continue.`;
  };
  return <ComposerNotice tone="danger" title="Usage limit reached" body={body()} />;
}
