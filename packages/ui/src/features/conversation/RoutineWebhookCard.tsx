import { Webhook } from "@openbot/ui";
import { useText } from "../../text";
import { ChatActionCard, type ChatActionCardStatus } from "./ChatActionCard";
import { RoutineWebhookEndpoint, type RoutineWebhookEndpointProps } from "./RoutineWebhookEndpoint";
import { RoutineWebhookEvents, type RoutineWebhookEventsProps } from "./RoutineWebhookEvents";

export type RoutineWebhookCardState = "idle" | "changed" | "saving" | "saved" | "error";

export interface RoutineWebhookCardProps extends RoutineWebhookEndpointProps, RoutineWebhookEventsProps {
  routineName: string;
  action: "created" | "updated";
  state?: RoutineWebhookCardState;
  errorText?: string | undefined;
  onSave: () => void;
  onOpenRoutine?: (() => void) | undefined;
}

export function RoutineWebhookCard(props: RoutineWebhookCardProps) {
  const { t } = useText();
  const status = (): ChatActionCardStatus | undefined => {
    switch (props.state ?? "idle") {
      case "changed":
        return {
          kind: "note",
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
        if (props.secret) return undefined;
        return {
          kind: "note",
          text: props.agentSecret
            ? t("routine.card.webhookSecretAgentNote", { name: props.agentSecret.agentName })
            : t("routine.card.webhookSecretNote"),
        };
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
          onUseSenderSecret={props.onUseSenderSecret}
          agentSecret={props.agentSecret}
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
