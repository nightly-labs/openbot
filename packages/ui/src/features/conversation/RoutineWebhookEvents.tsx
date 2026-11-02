import { type EventFilterDraft, eventFilterPointerValid } from "@openbot/contracts/event-filter-value";
import { Button, ChevronDown, ChevronRight, IconButton, Input, Plus, SlidersHorizontal, Text, X } from "@openbot/ui";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";

export interface RoutineWebhookEventsProps {
  eventType: string;
  filters: EventFilterDraft[];
  onEventTypeChange: (eventType: string) => void;
  onFiltersChange: (filters: EventFilterDraft[]) => void;
}

/** The events that start a webhook routine: one row that opens the event type and the filters. */
export function RoutineWebhookEvents(props: RoutineWebhookEventsProps) {
  const { t } = useText();
  const [eventsOpen, setEventsOpen] = createSignal(false);
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

  return (
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
              {(filter, index) => {
                const errorId = createUniqueId();
                const invalid = () => !eventFilterPointerValid(filter().pointer);
                return (
                  <div class="routine-webhook-filter">
                    <div class="agent-routine-event-filter">
                      <Input
                        size="sm"
                        aria-label={t("routine.webhook.filterPointer")}
                        aria-describedby={invalid() ? errorId : undefined}
                        value={filter().pointer}
                        placeholder={t("routine.webhook.filterPointerPlaceholder")}
                        invalid={invalid()}
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
                        onClick={() =>
                          props.onFiltersChange(props.filters.filter((_, itemIndex) => itemIndex !== index))
                        }
                      >
                        <X aria-hidden="true" />
                      </IconButton>
                    </div>
                    <Show when={invalid()}>
                      <Text id={errorId} variant="caption" tone="danger">
                        {t("routine.webhook.pointerInvalid")}
                      </Text>
                    </Show>
                  </div>
                );
              }}
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
  );
}
