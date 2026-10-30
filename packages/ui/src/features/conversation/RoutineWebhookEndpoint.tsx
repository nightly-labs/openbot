import { MASKED_WEBHOOK_SECRET } from "@openbot/contracts/event-filter-value";
import { Button, ConfirmDialog, CopyButton, IconButton, RefreshCw, Text } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";

export interface RoutineWebhookUrlFieldProps {
  /** The URL the host made. Null until the relay registers the route. */
  url: string | null;
  /** The relay connection of the host. Null when it is not known. */
  connected: boolean | null;
  onCopy?: (() => void) | undefined;
}

/** The URL of a saved webhook trigger, with a copy action beside it. */
export function RoutineWebhookUrlField(props: RoutineWebhookUrlFieldProps) {
  const { t } = useText();
  return (
    <div class="routine-webhook-field">
      <span class="routine-webhook-label">{t("routine.webhook.url")}</span>
      <Show
        when={props.url}
        fallback={
          <Text variant="caption" tone="muted" role="status" class="routine-webhook-value">
            {t(props.connected === false ? "routine.webhook.urlPendingOffline" : "routine.webhook.urlPending")}
          </Text>
        }
      >
        {(url) => (
          <>
            {/* The row leaves out "https://" to show more of the path. Copy gives the full URL. */}
            <code class="routine-webhook-value" title={url()}>
              {url().replace(/^https:\/\//, "")}
            </code>
            <CopyButton
              value={url()}
              label={t("routine.webhook.copyUrl")}
              copiedLabel={t("common.copied")}
              iconOnly
              onCopy={() => props.onCopy?.()}
            />
          </>
        )}
      </Show>
    </div>
  );
}

export interface RoutineWebhookSecretFieldProps {
  /** The signing secret that the host returned once. Null when there is nothing to show. */
  secret: string | null;
  onSecretDismiss: () => void;
  /** Makes a new secret. The parent shows it through `secret`. */
  onRegenerateSecret: () => Promise<void>;
  onCopy?: (() => void) | undefined;
}

/**
 * The signing secret of a saved webhook trigger: shown once with a copy action and a warning,
 * then masked with a regenerate action that asks first.
 */
export function RoutineWebhookSecretField(props: RoutineWebhookSecretFieldProps) {
  const { t, errorMessage } = useText();
  const [confirm, setConfirm] = createSignal<{ pending: boolean; error: string | null } | null>(null);

  async function regenerate(): Promise<void> {
    if (confirm()?.pending) return;
    setConfirm({ pending: true, error: null });
    try {
      await props.onRegenerateSecret();
      setConfirm(null);
    } catch (cause) {
      setConfirm({ pending: false, error: errorMessage(cause, t("routine.webhook.regenerateFailed")) });
    }
  }

  return (
    <>
      <div class="routine-webhook-field">
        <span class="routine-webhook-label">{t("routine.webhook.secretTitle")}</span>
        <Show
          when={props.secret}
          fallback={
            <>
              <code class="routine-webhook-value" aria-hidden="true">
                {MASKED_WEBHOOK_SECRET}
              </code>
              <span class="sr-only">{t("routine.webhook.secretHidden")}</span>
              <IconButton
                variant="ghost"
                label={t("routine.webhook.regenerateSecret")}
                onClick={() => setConfirm({ pending: false, error: null })}
              >
                <RefreshCw aria-hidden="true" />
              </IconButton>
            </>
          }
        >
          {(secret) => (
            <>
              <code class="routine-webhook-value routine-webhook-secret" title={secret()}>
                {secret()}
              </code>
              <CopyButton
                value={secret()}
                label={t("routine.webhook.copySecret")}
                copiedLabel={t("common.copied")}
                iconOnly
                onCopy={() => props.onCopy?.()}
              />
            </>
          )}
        </Show>
      </div>
      <Show when={props.secret}>
        <div class="routine-webhook-note routine-webhook-secret-note">
          <Text variant="caption" tone="warning">
            {t("routine.webhook.secretWarning")}
          </Text>
          <Button type="button" size="xs" variant="ghost" onClick={props.onSecretDismiss}>
            {t("common.done")}
          </Button>
        </div>
      </Show>

      <ConfirmDialog
        open={confirm() !== null}
        tone="destructive"
        title={t("routine.webhook.regenerateTitle")}
        description={t("routine.webhook.regenerateDescription")}
        confirmLabel={t("routine.webhook.regenerateConfirm")}
        cancelLabel={t("common.cancel")}
        pending={confirm()?.pending ?? false}
        error={confirm()?.error ?? undefined}
        initialFocus="cancel"
        onCancel={() => setConfirm(null)}
        onConfirm={regenerate}
      />
    </>
  );
}

export interface RoutineWebhookEndpointProps {
  /** The URL the host made. Null until the relay registers the route. */
  url: string | null;
  /** The relay connection of the host. Null when it is not known. */
  connected: boolean | null;
  /** The signing secret that the host returned once. Null when there is nothing to show. */
  secret: string | null;
  onSecretDismiss: () => void;
  /** Makes a new secret. The parent shows it through `secret`. */
  onRegenerateSecret: () => Promise<void>;
}

/** The URL and the signing secret of a saved webhook trigger, each with one action beside it. */
export function RoutineWebhookEndpoint(props: RoutineWebhookEndpointProps) {
  const { t } = useText();
  return (
    <>
      <RoutineWebhookUrlField url={props.url} connected={props.connected} />
      <Show when={props.url && props.connected === false}>
        <Text variant="caption" tone="warning" class="routine-webhook-note">
          {t("routine.webhook.relayOffline")}
        </Text>
      </Show>
      <RoutineWebhookSecretField
        secret={props.secret}
        onSecretDismiss={props.onSecretDismiss}
        onRegenerateSecret={props.onRegenerateSecret}
      />
    </>
  );
}
