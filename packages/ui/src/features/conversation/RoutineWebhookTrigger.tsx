import {
  type EventFilterDraft,
  eventFilterPointerValid,
  MASKED_WEBHOOK_SECRET,
} from "@openbot/contracts/event-filter-value";
import {
  Button,
  ChevronDown,
  ChevronRight,
  ConfirmDialog,
  CopyButton,
  IconButton,
  Input,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Text,
  Webhook,
  X,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";

export interface RoutineWebhookTriggerProps {
  /** The URL the host made. Null until the relay registers the route. */
  url: string | null;
  /** True when the saved routine has a webhook trigger, so a URL and a secret exist. */
  saved: boolean;
  /** The relay connection of the host. Null when it is not known. */
  connected: boolean | null;
  eventType: string;
  filters: EventFilterDraft[];
  onEventTypeChange: (eventType: string) => void;
  onFiltersChange: (filters: EventFilterDraft[]) => void;
  /** The signing secret that the host returned once. Null when there is nothing to show. */
  secret: string | null;
  onSecretDismiss: () => void;
  /** Makes a new secret. The parent shows it through `secret`. */
  onRegenerateSecret: () => Promise<void>;
  /** A control at the end of the header, such as the menu that changes the trigger. */
  menu?: JSX.Element;
}

/**
 * The webhook trigger as one card: what starts the routine, the endpoint, the signing secret
 * and the events that start it. Each value has one action beside it.
 */
export function RoutineWebhookTrigger(props: RoutineWebhookTriggerProps) {
  const { t, errorMessage } = useText();
  const [eventsOpen, setEventsOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal<{ pending: boolean; error: string | null } | null>(null);
  const eventTypeLabelId = createUniqueId();
  const eventTypeHintId = createUniqueId();
  let eventTypeInput: HTMLInputElement | undefined;

  // Most webhooks need no filter, so the card hides the events row until the user sets one.
  const filtered = () => props.eventType.trim() !== "" || props.filters.length > 0;
  const eventsSummary = () => {
    const parts = [props.eventType.trim() || t("routine.webhook.eventsAll")];
    if (props.filters.length > 0) parts.push(t("routine.webhook.filterCount", { count: props.filters.length }));
    return parts.join(" · ");
  };

  function updateFilter(index: number, change: Partial<EventFilterDraft>): void {
    props.onFiltersChange(
      props.filters.map((filter, itemIndex) => (itemIndex === index ? { ...filter, ...change } : filter)),
    );
  }

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
    <div class="routine-trigger-card">
      <div class="routine-trigger-card-header">
        <span class="routine-trigger-icon" aria-hidden="true">
          <Webhook />
        </span>
        <span class="routine-trigger-card-title">{t("routine.trigger.webhookDescription")}</span>
        <span class="routine-trigger-action">{props.menu}</span>
      </div>

      <Show
        when={props.saved}
        fallback={
          <Text variant="caption" tone="muted" class="routine-webhook-note">
            {t("routine.webhook.urlAfterSave")}
          </Text>
        }
      >
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
                />
              </>
            )}
          </Show>
        </div>
        <Show when={props.url && props.connected === false}>
          <Text variant="caption" tone="warning" class="routine-webhook-note">
            {t("routine.webhook.relayOffline")}
          </Text>
        </Show>

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
      </Show>

      <Show
        when={eventsOpen() || filtered()}
        fallback={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="routine-webhook-filter-link"
            onClick={() => {
              setEventsOpen(true);
              // The link leaves the page, so focus goes to the first field it opened.
              onSettled(() => eventTypeInput?.focus());
            }}
          >
            <SlidersHorizontal aria-hidden="true" />
            {t("routine.webhook.filterEvents")}
          </Button>
        }
      >
        <Button
          type="button"
          variant="ghost"
          class="routine-webhook-field routine-webhook-events-toggle"
          aria-expanded={eventsOpen() ? "true" : "false"}
          onClick={() => setEventsOpen((open) => !open)}
        >
          <span class="routine-webhook-label">{t("routine.webhook.events")}</span>
          <span class="routine-webhook-value">{eventsSummary()}</span>
          <Show when={eventsOpen()} fallback={<ChevronRight aria-hidden="true" />}>
            <ChevronDown aria-hidden="true" />
          </Show>
        </Button>
        <Show when={eventsOpen()}>
          <div class="routine-webhook-events">
            <div class="settings-field">
              <span id={eventTypeLabelId}>{t("routine.webhook.eventType")}</span>
              <Input
                ref={(element) => (eventTypeInput = element)}
                size="sm"
                aria-labelledby={eventTypeLabelId}
                aria-describedby={eventTypeHintId}
                value={props.eventType}
                placeholder={t("routine.webhook.eventTypePlaceholder")}
                onValueChange={props.onEventTypeChange}
              />
              <Text id={eventTypeHintId} variant="caption" tone="muted">
                {t("routine.webhook.eventTypeHint")}
              </Text>
            </div>
            <div class="settings-field">
              <span>{t("routine.webhook.filters")}</span>
              {/* Not keyed: each keystroke makes a new row object, and a keyed row would remount and lose focus. */}
              <For each={props.filters} keyed={false}>
                {(filter, index) => (
                  <div class="agent-routine-event-filter">
                    <Input
                      size="sm"
                      aria-label={t("routine.webhook.filterPointer")}
                      value={filter().pointer}
                      placeholder={t("routine.webhook.filterPointerPlaceholder")}
                      invalid={!eventFilterPointerValid(filter().pointer)}
                      onValueChange={(pointer) => updateFilter(index, { pointer })}
                    />
                    <Input
                      size="sm"
                      aria-label={t("routine.webhook.filterValue")}
                      value={filter().value}
                      placeholder={t("routine.webhook.filterValue")}
                      onValueChange={(value) => updateFilter(index, { value })}
                    />
                    <IconButton
                      variant="ghost"
                      label={t("routine.webhook.removeFilter")}
                      onClick={() => props.onFiltersChange(props.filters.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <X aria-hidden="true" />
                    </IconButton>
                  </div>
                )}
              </For>
              <Text variant="caption" tone="muted">
                {t("routine.webhook.filtersHint")}
              </Text>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="routine-webhook-add-filter"
                onClick={() => props.onFiltersChange([...props.filters, { pointer: "", value: "" }])}
              >
                <Plus aria-hidden="true" />
                {t("routine.webhook.addFilter")}
              </Button>
            </div>
          </div>
        </Show>
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
    </div>
  );
}
