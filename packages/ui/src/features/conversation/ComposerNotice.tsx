import { type AgentProviderId, agentProviderName } from "@openbot/contracts/agent-providers";
import type { AppFormat } from "@openbot/i18n";
import { Button, ErrorReference, Info, TriangleAlert } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, Show } from "solid-js";
import { createCodeSignInFallback } from "../../components/createCodeSignInFallback";
import { useText } from "../../text";
import { CloseIcon } from "./ConversationIcons";

export function ComposerNotice(props: {
  tone?: "warning" | "danger" | "info";
  title?: string | undefined;
  body: string;
  reference?: string | null | undefined;
  action?: JSX.Element;
  conversationKey?: string | null | undefined;
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
          <NoticeContent
            tone={props.tone}
            title={props.title}
            body={props.body}
            reference={props.reference}
            action={props.action}
          />
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
          <NoticeContent
            tone={props.tone}
            title={props.title}
            body={props.body}
            reference={props.reference}
            action={props.action}
          />
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

function NoticeContent(props: {
  tone?: "warning" | "danger" | "info" | undefined;
  title?: string | undefined;
  body: string;
  reference?: string | null | undefined;
  action?: JSX.Element;
}) {
  return (
    <>
      <Show when={props.tone === "info"} fallback={<TriangleAlert class="composer-notice-icon" aria-hidden="true" />}>
        <Info class="composer-notice-icon" aria-hidden="true" />
      </Show>
      <div class="composer-notice-copy">
        <Show when={props.title}>{(title) => <strong>{title()}</strong>}</Show>
        <p>{props.body}</p>
        <ErrorReference reference={props.reference} />
      </div>
      <Show when={props.action}>{props.action}</Show>
    </>
  );
}

export function ComposerSignInNotice(props: {
  provider: AgentProviderId;
  onSignIn: (provider: AgentProviderId) => void | Promise<void>;
  onSignInWithCode?: ((provider: AgentProviderId) => void) | undefined;
  signingIn?: boolean;
  onShown?: () => void;
}) {
  const { t, errorMessage } = useText();
  createEffect(
    () => props.provider,
    () => props.onShown?.(),
  );
  const providerName = () => agentProviderName(props.provider);
  const [starting, setStarting] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  const busy = () => starting() || Boolean(props.signingIn);
  const codeFallback = createCodeSignInFallback(() => Boolean(props.signingIn));
  const signIn = async () => {
    if (busy()) return;
    setStarting(true);
    setFailure(null);
    codeFallback.startedInBrowser();
    try {
      await props.onSignIn(props.provider);
    } catch (error) {
      setFailure(errorMessage(error, t("app.provider.connectFailedRetry", { name: providerName() })));
    } finally {
      setStarting(false);
    }
  };
  return (
    <ComposerNotice
      title={t("composer.signIn.title")}
      body={failure() ?? t("composer.signIn.body", { provider: providerName() })}
      action={
        <>
          <Show when={props.onSignInWithCode && codeFallback.offered() ? props.onSignInWithCode : undefined}>
            {(signInWithCode) => (
              <Button
                variant="outline"
                size="sm"
                type="button"
                class="composer-notice-code-fallback"
                aria-label={t("provider.aria.codeFallback", { name: providerName() })}
                onClick={() => {
                  codeFallback.startedWithCode();
                  signInWithCode()(props.provider);
                }}
              >
                {t("provider.action.signInWithCode")}
              </Button>
            )}
          </Show>
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
        </>
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

export function formatUsageReset(resetsAt: number | null | undefined, format: AppFormat): string | null {
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

export function ComposerUsageLimitNotice(props: {
  provider: AgentProviderId;
  resetsAt?: number | null;
  onCredits?: boolean;
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
    if (props.onCredits)
      return reset
        ? t("composer.usageLimit.creditsResets", { provider, reset })
        : t("composer.usageLimit.credits", { provider });
    return reset
      ? t("composer.usageLimit.resets", { provider, reset })
      : t("composer.usageLimit.selectModel", { provider });
  };
  return (
    <ComposerNotice
      tone={props.onCredits ? "warning" : "danger"}
      title={props.onCredits ? t("composer.usageLimit.creditsTitle") : t("composer.usageLimit.title")}
      body={body()}
      onDismiss={props.onDismiss}
    />
  );
}
