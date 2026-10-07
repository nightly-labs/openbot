import { type EventFilter, isEventFilterPointer } from "@openbot/contracts/ipc-events";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  Input,
  Plus,
  Text,
  X,
} from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";

/** A filter row while the user edits it. The value stays text until the routine is saved. */
export interface RoutineWebhookFilterDraft {
  pointer: string;
  value: string;
}

export interface RoutineWebhookTriggerProps {
  /** The URL the host made. Null until the relay registers the route. */
  url: string | null;
  /** True when the saved routine has a webhook trigger, so a URL and a secret exist. */
  saved: boolean;
  /** The relay connection of the host. Null when it is not known. */
  connected: boolean | null;
  eventType: string;
  filters: RoutineWebhookFilterDraft[];
  onEventTypeChange: (eventType: string) => void;
  onFiltersChange: (filters: RoutineWebhookFilterDraft[]) => void;
  /** The signing secret that the host returned once. Null when there is nothing to show. */
  secret: string | null;
  onSecretDismiss: () => void;
  /** Makes a new secret. The parent shows it through `secret`. Left out, the action is hidden. */
  onRegenerateSecret?: () => Promise<void>;
}

export function RoutineWebhookTrigger(props: RoutineWebhookTriggerProps) {
  const { t, errorMessage } = useText();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal<{ pending: boolean; error: string | null } | null>(null);

  function updateFilter(index: number, change: Partial<RoutineWebhookFilterDraft>): void {
    props.onFiltersChange(
      props.filters.map((filter, itemIndex) => (itemIndex === index ? { ...filter, ...change } : filter)),
    );
  }

  async function regenerate(): Promise<void> {
    const action = props.onRegenerateSecret;
    if (!action || confirm()?.pending) return;
    setConfirm({ pending: true, error: null });
    try {
      await action();
      setConfirm(null);
    } catch (cause) {
      setConfirm({ pending: false, error: errorMessage(cause, t("routine.webhook.regenerateFailed")) });
    }
  }

  return (
    <div class="agent-routine-webhook">
      <div class="settings-field">
        <span>{t("routine.webhook.url")}</span>
        <Show
          when={props.saved}
          fallback={
            <Text variant="caption" tone="muted">
              {t("routine.webhook.urlAfterSave")}
            </Text>
          }
        >
          <Show
            when={props.url}
            fallback={
              <Text variant="caption" tone="muted" role="status">
                {t(props.connected === false ? "routine.webhook.urlPendingOffline" : "routine.webhook.urlPending")}
              </Text>
            }
          >
            {(url) => (
              <>
                <div class="agent-routine-webhook-row">
                  <Input readonly value={url()} aria-label={t("routine.webhook.url")} />
                  <CopyButton
                    value={url()}
                    label={t("routine.webhook.copyUrl")}
                    copiedLabel={t("common.copied")}
                    size="sm"
                    variant="secondary"
                  />
                </div>
                <Show when={props.connected === false}>
                  <Text variant="caption" tone="warning">
                    {t("routine.webhook.relayOffline")}
                  </Text>
                </Show>
              </>
            )}
          </Show>
        </Show>
      </div>

      <Show when={props.secret}>
        {(secret) => (
          <Alert tone="warning" class="agent-routine-webhook-secret">
            <AlertContent>
              <AlertTitle>{t("routine.webhook.secretTitle")}</AlertTitle>
              <AlertDescription>{t("routine.webhook.secretWarning")}</AlertDescription>
              <div class="agent-routine-webhook-row">
                <Input readonly value={secret()} aria-label={t("routine.webhook.secretTitle")} />
                <CopyButton
                  value={secret()}
                  label={t("routine.webhook.copySecret")}
                  copiedLabel={t("common.copied")}
                  size="sm"
                  variant="secondary"
                />
              </div>
              <AlertActions>
                <Button type="button" size="sm" variant="secondary" onClick={props.onSecretDismiss}>
                  {t("common.done")}
                </Button>
              </AlertActions>
            </AlertContent>
          </Alert>
        )}
      </Show>

      <Show when={props.saved && props.onRegenerateSecret && !props.secret}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          class="agent-routine-disclosure"
          onClick={() => setConfirm({ pending: false, error: null })}
        >
          {t("routine.webhook.regenerateSecret")}
        </Button>
      </Show>

      <label class="settings-field">
        <span>{t("routine.webhook.eventType")}</span>
        <Input
          value={props.eventType}
          placeholder={t("routine.webhook.eventTypePlaceholder")}
          onValueChange={props.onEventTypeChange}
        />
        <Text variant="caption" tone="muted">
          {t("routine.webhook.eventTypeHint")}
        </Text>
      </label>

      <div class="agent-routine-webhook-filters">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          class="agent-routine-disclosure"
          aria-expanded={filtersOpen() ? "true" : "false"}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          {t("routine.webhook.filters")}
          <Show when={props.filters.length > 0}>
            <Badge variant="secondary">{props.filters.length}</Badge>
          </Show>
        </Button>
        <Show when={filtersOpen()}>
          <div class="agent-routine-webhook-filter-list">
            <Text variant="caption" tone="muted">
              {t("routine.webhook.filtersHint")}
            </Text>
            <For each={props.filters}>
              {(filter, index) => (
                <div class="agent-routine-event-filter">
                  <Input
                    aria-label={t("routine.webhook.filterPointer")}
                    value={filter.pointer}
                    placeholder={t("routine.webhook.filterPointerPlaceholder")}
                    invalid={!isEventFilterPointer(filter.pointer)}
                    onValueChange={(pointer) => updateFilter(index(), { pointer })}
                  />
                  <Input
                    aria-label={t("routine.webhook.filterValue")}
                    value={filter.value}
                    placeholder={t("routine.webhook.filterValue")}
                    onValueChange={(value) => updateFilter(index(), { value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("routine.webhook.removeFilter")}
                    onClick={() => props.onFiltersChange(props.filters.filter((_, itemIndex) => itemIndex !== index()))}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              )}
            </For>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class="agent-routine-disclosure"
              onClick={() => props.onFiltersChange([...props.filters, { pointer: "", value: "" }])}
            >
              <Plus aria-hidden="true" />
              {t("routine.webhook.addFilter")}
            </Button>
          </div>
        </Show>
      </div>

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

/** Reads a typed value: `true`, `false`, `null` and numbers match as JSON values. Other text is a string. */
export function routineWebhookFilterValue(raw: string): EventFilter["value"] {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  return raw;
}

export function routineWebhookFilterDraft(filter: EventFilter): RoutineWebhookFilterDraft {
  return { pointer: filter.pointer, value: filter.value === null ? "null" : String(filter.value) };
}

export function routineWebhookFilters(filters: readonly RoutineWebhookFilterDraft[]): EventFilter[] {
  return filters.map((filter) => ({ pointer: filter.pointer, value: routineWebhookFilterValue(filter.value) }));
}

export function routineWebhookFiltersValid(filters: readonly RoutineWebhookFilterDraft[]): boolean {
  return filters.every((filter) => isEventFilterPointer(filter.pointer));
}
