import { Webhook } from "@openbot/ui";
import { useText } from "../../text";
import { ChatActionCard, type ChatActionCardStatus } from "./ChatActionCard";
import { RoutineWebhookEndpoint, type RoutineWebhookEndpointProps } from "./RoutineWebhookEndpoint";
import { RoutineWebhookEvents, type RoutineWebhookEventsProps } from "./RoutineWebhookEvents";

/** `changed`: the events differ from the saved ones. */
export type RoutineWebhookCardState = "idle" | "changed" | "saving" | "saved" | "error";

export interface RoutineWebhookCardProps extends RoutineWebhookEndpointProps, RoutineWebhookEventsProps {
  routineName: string;
  action: "created" | "updated";
  state?: RoutineWebhookCardState;
  /** With `error`, what is wrong. With `changed`, why the last save failed, shown beside Save. */
  errorText?: string | undefined;
  /** Saves the event type and the filters. Shown while the state is `changed`. */
  onSave: () => void;
  onOpenRoutine?: (() => void) | undefined;
}

/**
 * The chat record of a webhook routine an agent created or changed. The agent never gets the
 * signing secret, so the person makes one here. The person can also change which events start it.
 */
export function RoutineWebhookCard(props: RoutineWebhookCardProps) {
  const { t } = useText();
  const status = (): ChatActionCardStatus | undefined => {
    switch (props.state ?? "idle") {
      case "changed":
        return {
          kind: "note",
          // After a failed save, the error stays beside Save.
          text: props.errorText ?? t("routine.card.webhookChanged"),
          action: { label: t("common.save"), onClick: props.onSave },
        };
      case "saving":
        return { kind: "busy", text: t("common.saving") };
      case "saved":
        return { kind: "done", text: t("routine.card.saved") };
      case "error":
        return { kind: "error", text: props.errorText ?? t("routine.card.webhookSaveFailed") };
      case "idle":
        return props.secret ? undefined : { kind: "note", text: t("routine.card.webhookSecretNote") };
    }
  };
  return (
    <ChatActionCard
      class="routine-webhook-card"
      icon={<Webhook />}
      eyebrow={props.action === "created" ? t("routine.card.webhookCreated") : t("routine.card.webhookUpdated")}
      title={props.routineName}
      onOpen={props.onOpenRoutine}
      openLabel={t("routine.card.open", { name: props.routineName })}
      status={status()}
    >
      <div class="routine-webhook-card-endpoint">
        <RoutineWebhookEndpoint
          url={props.url}
          connected={props.connected}
          secret={props.secret}
          onSecretDismiss={props.onSecretDismiss}
          onRegenerateSecret={props.onRegenerateSecret}
        />
        <RoutineWebhookEvents
          eventType={props.eventType}
          filters={props.filters}
          onEventTypeChange={props.onEventTypeChange}
          onFiltersChange={props.onFiltersChange}
        />
      </div>
    </ChatActionCard>
  );
}
