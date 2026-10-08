/**
 * The webhook of a routine, set from the canvas: its endpoint, its signing secret, and the events
 * that start a run. The card is the one the routine settings use. Changes to the events wait for
 * Save; a new secret is made at once and shown one time.
 */

import {
  type EventFilterDraft,
  eventFilterDraft,
  eventFilterDraftsValid,
  eventFiltersFromDrafts,
} from "@openbot/contracts/event-filter-value";
import type { EventFilter } from "@openbot/contracts/ipc-events";
import { Button } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { RoutineWebhookTrigger } from "../conversation/RoutineWebhookTrigger";
import type { DiagramRoutineWebhook } from "./diagram-model";

/** What the canvas can do with the webhook of a routine. The app reaches the host for each one. */
export interface DiagramWebhookActions {
  /** The connection of the host to the relay. Null while it is not known. */
  connected: boolean | null;
  onSave: (routineNodeId: string, change: { eventType: string | null; filters: EventFilter[] }) => Promise<void>;
  /** Makes a new signing secret and answers it, to be shown one time. */
  onRegenerateSecret: (routineNodeId: string) => Promise<string>;
}

export function DiagramRoutineWebhookConfig(props: {
  routineNodeId: string;
  webhook: DiagramRoutineWebhook;
  actions: DiagramWebhookActions;
}) {
  const { t, errorMessage } = useText();
  const [eventType, setEventType] = createSignal(props.webhook.eventType ?? "");
  const [filters, setFilters] = createSignal<EventFilterDraft[]>(props.webhook.filters.map(eventFilterDraft));
  const [secret, setSecret] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const changed = () =>
    (eventType().trim() || null) !== props.webhook.eventType ||
    JSON.stringify(eventFiltersFromDrafts(filters())) !== JSON.stringify(props.webhook.filters);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await props.actions.onSave(props.routineNodeId, {
        eventType: eventType().trim() || null,
        filters: eventFiltersFromDrafts(filters()),
      });
    } catch (caught) {
      setError(errorMessage(caught, t("diagram.routine.webhookSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="diagram-routine-webhook">
      <RoutineWebhookTrigger
        url={props.webhook.url}
        saved
        connected={props.actions.connected}
        eventType={eventType()}
        filters={filters()}
        onEventTypeChange={setEventType}
        onFiltersChange={setFilters}
        secret={secret()}
        onSecretDismiss={() => setSecret(null)}
        onRegenerateSecret={async () => {
          setSecret(await props.actions.onRegenerateSecret(props.routineNodeId));
        }}
      />
      <Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
      <Show when={changed()}>
        <div class="diagram-routine-webhook-actions">
          <Button
            type="button"
            size="xs"
            disabled={saving() || !eventFilterDraftsValid(filters())}
            onClick={() => void save()}
          >
            {saving() ? t("diagram.routine.webhookSaving") : t("diagram.routine.webhookSave")}
          </Button>
        </div>
      </Show>
    </div>
  );
}
