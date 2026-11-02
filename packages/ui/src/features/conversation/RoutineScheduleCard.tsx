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
  /** Without it the card is read-only. */
  onChange?: ((schedule: RoutineScheduleDraft) => void) | undefined;
  /** One edit on the row is complete. A card that saves each edit saves here. */
  onEditEnd?: () => void;
  state?: RoutineScheduleCardState;
  errorText?: string | undefined;
  /** For example "Thu, Sep 25 at 8:20 AM". */
  nextRunLabel?: string | undefined;
  /** For example "Warsaw time". Give it only when the routine zone is not the viewer's zone. */
  timeZoneLabel?: string | undefined;
  onOpenRoutine?: () => void;
  today?: Date;
  /** The frequencies the menu offers. Defaults to all of them. */
  kinds?: RoutineDraftKindOption[];
}

/**
 * The chat record of a routine an agent created or changed. Its schedule row is the same one
 * the settings panel uses, so the person can move the run without leaving the conversation.
 */
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
        const text = nextRun();
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
