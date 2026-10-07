import type { EventActivity, EventRoutineRef } from "@openbot/contracts/ipc-events";
import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  RefreshCw,
  Text,
} from "@openbot/ui";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ROUTINE_RUN_EVENT_LABELS, type RoutineWebhooksApi } from "./RoutineWebhookNotifications";

export interface RoutineWebhookActivityProps {
  api: Pick<RoutineWebhooksApi, "listActivity" | "retryDelivery">;
  routine: EventRoutineRef;
  disabled?: boolean;
}

const ACTIVITY_LIMIT = 50;

const RECEIVED_STATUS_LABELS = {
  started: "routine.activity.started",
  ignored: "routine.activity.ignored",
} as const;
const IGNORED_REASON_LABELS = {
  "event-type": "routine.activity.ignored.eventType",
  filter: "routine.activity.ignored.filter",
  inactive: "routine.activity.ignored.inactive",
} as const;
const DELIVERY_STATUS_LABELS = {
  queued: "routine.activity.delivery.queued",
  sending: "routine.activity.delivery.sending",
  succeeded: "routine.activity.delivery.succeeded",
  failed: "routine.activity.delivery.failed",
} as const;
const STATUS_BADGES = {
  started: "success-light",
  ignored: "secondary",
  queued: "secondary",
  sending: "info-light",
  succeeded: "success-light",
  failed: "destructive-light",
} as const;

export function RoutineWebhookActivity(props: RoutineWebhookActivityProps) {
  const { t, errorMessage, format } = useText();
  const [items, setItems] = createSignal<EventActivity[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [retrying, setRetrying] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function load(): Promise<void> {
    const routine = props.routine;
    setLoading(true);
    setError(null);
    try {
      const rows = await props.api.listActivity({ owner: routine.owner, routineId: routine.id, limit: ACTIVITY_LIMIT });
      if (props.routine.id === routine.id) setItems(rows);
    } catch (cause) {
      setError(errorMessage(cause, t("routine.activity.loadFailed")));
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    () => props.routine.id,
    () => {
      setItems([]);
      void untrack(load);
    },
  );

  async function retry(item: EventActivity): Promise<void> {
    if (item.kind !== "delivery" || retrying()) return;
    setRetrying(item.id);
    setError(null);
    try {
      await props.api.retryDelivery({ id: item.id, owner: props.routine.owner, routineId: props.routine.id });
      await load();
    } catch (cause) {
      setError(errorMessage(cause, t("routine.activity.retryFailed")));
    } finally {
      setRetrying(null);
    }
  }

  function title(item: EventActivity): string {
    return item.kind === "received"
      ? t("routine.activity.received", { eventType: item.eventType })
      : t("routine.activity.delivery", { eventType: t(ROUTINE_RUN_EVENT_LABELS[item.eventType]) });
  }

  function status(item: EventActivity): string {
    if (item.kind === "delivery") return t(DELIVERY_STATUS_LABELS[item.status]);
    if (item.status === "ignored" && item.reason) return t(IGNORED_REASON_LABELS[item.reason]);
    return t(RECEIVED_STATUS_LABELS[item.status]);
  }

  function details(item: EventActivity): string {
    const parts = [format.date(new Date(item.occurredAt), { dateStyle: "medium", timeStyle: "short" })];
    if (item.kind === "delivery") {
      parts.push(t("routine.activity.attempts", { count: item.attempt }));
      if (item.statusCode !== null) parts.push(t("routine.activity.statusCode", { code: item.statusCode }));
    }
    return parts.join(" · ");
  }

  return (
    <div class="agent-routine-activity">
      <div class="agent-routine-webhook-toolbar">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          class="agent-routine-disclosure"
          disabled={loading()}
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" />
          {t("routine.activity.refresh")}
        </Button>
      </div>
      <Show when={error()}>
        {(message) => (
          <Text variant="caption" tone="danger" role="alert">
            {message()}
          </Text>
        )}
      </Show>
      <Show
        when={!loading() || items().length > 0}
        fallback={
          <Text variant="caption" tone="muted">
            {t("common.loading")}
          </Text>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <Text variant="caption" tone="muted">
              {t("routine.activity.empty")}
            </Text>
          }
        >
          <ItemGroup class="agent-routine-webhook-list" surface="subtle">
            <For each={items()}>
              {(item) => (
                <Item size="compact">
                  <ItemContent>
                    <ItemTitle>{title(item)}</ItemTitle>
                    <ItemDescription>{details(item)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant={STATUS_BADGES[item.status]}>{status(item)}</Badge>
                    <Show when={item.kind === "delivery" && item.status === "failed"}>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={Boolean(props.disabled) || retrying() !== null}
                        loading={retrying() === item.id}
                        onClick={() => void retry(item)}
                      >
                        {t("common.retry")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              )}
            </For>
          </ItemGroup>
        </Show>
      </Show>
    </div>
  );
}
