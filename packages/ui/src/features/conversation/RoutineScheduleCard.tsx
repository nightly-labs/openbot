import { CalendarClock } from "@openbot/ui";
import { useText } from "../../text";
import { ChatActionCard, type ChatActionCardStatus } from "./ChatActionCard";
import { RoutineSchedulePicker } from "./RoutineSchedulePicker";
import type { RoutineDraftKindOption, RoutineScheduleDraft } from "./routine-schedule-draft";

type RoutineScheduleCardState = "idle" | "saving" | "saved" | "error" | "deleted";

export interface RoutineScheduleCardProps {
  routineName: string;
  action: "created" | "updated";
  schedule: RoutineScheduleDraft;
  onChange?: ((schedule: RoutineScheduleDraft) => void) | undefined;
  onEditEnd?: () => void;
  state?: RoutineScheduleCardState;
  errorText?: string | undefined;
  nextRunLabel?: string | undefined;
  timeZoneLabel?: string | undefined;
  pausedLabel?: string | undefined;
  onOpenRoutine?: () => void;
  today?: Date;
  kinds?: RoutineDraftKindOption[];
}

export function RoutineScheduleCard(props: RoutineScheduleCardProps) {
  const { t } = useText();
  const state = () => props.state ?? "idle";
  const deleted = () => state() === "deleted";
  const nextRun = () =>
    props.nextRunLabel
      ? [t("routine.card.nextRun", { when: props.nextRunLabel }), props.timeZoneLabel].filter(Boolean).join(" · ")
      : undefined;
  const status = (): ChatActionCardStatus | undefined => {
    switch (state()) {
      case "saving":
        return { kind: "busy", text: t("common.saving") };
      case "saved":
        return { kind: "done", text: [t("routine.card.saved"), nextRun()].filter(Boolean).join(" · ") };
      case "error":
        return { kind: "error", text: props.errorText ?? t("routine.card.saveFailed") };
      case "deleted":
        return { kind: "note", text: t("routine.card.deleted") };
      case "idle": {
        const text = nextRun() ?? props.pausedLabel;
        return text ? { kind: "note", text } : undefined;
      }
    }
  };
  return (
    <ChatActionCard
      class="routine-schedule-card"
      icon={<CalendarClock />}
      eyebrow={props.action === "created" ? t("routine.card.created") : t("routine.card.updated")}
      title={props.routineName}
      removed={deleted()}
      onOpen={props.onOpenRoutine}
      openLabel={t("routine.card.open", { name: props.routineName })}
      status={status()}
    >
      <RoutineSchedulePicker
        density="card"
        schedule={props.schedule}
        today={props.today}
        kinds={props.kinds}
        disabled={deleted() || !props.onChange}
        onChange={(schedule) => props.onChange?.(schedule)}
        onEditEnd={() => props.onEditEnd?.()}
      />
    </ChatActionCard>
  );
}
