import type { RoutineSchedule } from "@openbot/contracts/ipc";
import { routineOnceInstant } from "@openbot/team-client/routine-schedule";
import { routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import AlarmClock from "lucide-react-native/icons/alarm-clock";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Webhook from "lucide-react-native/icons/webhook";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { type MobileText, useText } from "@/shared/lib/text";
import { isWebhookRoutine, type RoutineRecord, saveRoutineActive } from "./agent-record-editor";
import { RoutineActiveSwitch } from "./routine-active-switch";
import { TRIGGER_TEXT } from "./routine-trigger-picker";

/**
 * Agent info > Routines. As on desktop, each routine is a card: the trigger icon, the name and when
 * it runs, and a switch that pauses or resumes it. A press on the card opens the editor.
 */
export function AgentRoutines({
  agent,
  routines,
  queryKey,
}: {
  agent: MobileAgent;
  routines: RoutineRecord[];
  /** The query that holds the routines. A saved switch reloads it, so the card shows the host result. */
  queryKey: QueryKey;
}) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  // The new state of each routine whose switch waits for the host.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [error, setError] = useState<string | null>(null);

  function setActive(routine: RoutineRecord, active: boolean) {
    if (pending.has(routine.id)) return;
    void haptics.selection();
    setError(null);
    setPending((current) => new Map(current).set(routine.id, active));
    saveRoutineActive(workspace, { kind: "agent", id: agent.id }, agent.serverId, routine, active)
      .then(() => {
        void haptics.notification("success");
        return queryClient.invalidateQueries({ queryKey });
      })
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.agent.record.saveFailed")));
      })
      .finally(() =>
        setPending((current) => {
          const next = new Map(current);
          next.delete(routine.id);
          return next;
        }),
      );
  }

  return (
    <>
      {routines.map((routine) => (
        <RoutineCard
          key={routine.id}
          routine={routine}
          active={pending.get(routine.id) ?? routine.active}
          busy={pending.has(routine.id)}
          onActiveChange={(active) => setActive(routine, active)}
          onPress={() =>
            router.push({
              pathname: "/agent-info/[agentId]/routine",
              params: { agentId: agent.id, serverId: agent.serverId, recordId: routine.id },
            })
          }
        />
      ))}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-4 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection>
        {!routines.length ? (
          <SettingsRow>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.agent.info.noRoutines")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow
          onPress={() =>
            router.push({
              pathname: "/agent-info/[agentId]/routine",
              params: { agentId: agent.id, serverId: agent.serverId },
            })
          }
        >
          <Typography.Paragraph>{t("mobile.agent.info.addRoutine")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

function RoutineCard({
  routine,
  active,
  busy,
  onActiveChange,
  onPress,
}: {
  routine: RoutineRecord;
  active: boolean;
  busy: boolean;
  onActiveChange: (active: boolean) => void;
  onPress: () => void;
}) {
  const text = useText();
  const [success, muted] = useCSSVariable(["--openbot-success-text", "--openbot-text-grouped-secondary"]);
  const completed = routineCompleted(routine);
  const Icon = completed ? CircleCheck : isWebhookRoutine(routine) ? Webhook : AlarmClock;
  const summary = routineSummary(routine, completed, text);
  return (
    <SettingsSection>
      {/* The switch is beside the card's button, not in it, so a press on the switch does not open the editor. */}
      <View className="flex-row items-center gap-3 pr-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${routine.name}, ${summary}`}
          className="min-h-12 min-w-0 flex-1 flex-row items-center gap-3 py-3 pl-4"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          onPress={() => {
            void haptics.impact("soft");
            onPress();
          }}
        >
          <Icon size={20} color={String(active ? success : muted)} strokeWidth={1.75} />
          <View className="min-w-0 flex-1 gap-1">
            <Typography.Paragraph numberOfLines={1}>{routine.name}</Typography.Paragraph>
            <Typography.Paragraph type="body-xs" numberOfLines={2} className="text-grouped-secondary">
              {summary}
            </Typography.Paragraph>
          </View>
        </Pressable>
        {/* A done one-time routine needs a new time to run again, so only the editor resumes it. */}
        <RoutineActiveSwitch
          label={routine.name}
          value={active}
          disabled={busy || completed}
          onValueChange={onActiveChange}
        />
      </View>
    </SettingsSection>
  );
}

function routineSchedule(routine: RoutineRecord): RoutineSchedule | null {
  return "schedule" in routine.trigger ? routine.trigger.schedule : null;
}

/**
 * A one-time routine that the host finished: the host paused it at or after its time. A routine
 * that the person paused before its time stays paused. The desktop list uses the same rule.
 */
function routineCompleted(routine: RoutineRecord): boolean {
  const schedule = routineSchedule(routine);
  if (routine.active || schedule?.kind !== "once") return false;
  return Date.parse(routine.updatedAt) >= routineOnceInstant(schedule, routine.timezone).getTime();
}

/** "Daily · 9:00 AM", "Weekly · Monday · 9:00 AM", "Webhook". The switch shows the state, so this does not. */
function routineSummary(routine: RoutineRecord, completed: boolean, { t, format }: MobileText): string {
  const schedule = routineSchedule(routine);
  if (!schedule) return t(TRIGGER_TEXT.webhook.title);
  const clock = (time: string) => {
    const [hour = 0, minute = 0] = time.split(":").map(Number);
    // UTC, so that no clock change of the phone's zone moves the wall-clock time.
    return format.date(Date.UTC(2000, 0, 1, hour, minute), { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  };
  const parts = [t(TRIGGER_TEXT[routineScheduleToDraft(schedule).kind].title)];
  if (schedule.kind === "once") {
    const [year = 0, month = 1, day = 1] = schedule.date.split("-").map(Number);
    parts.push(
      format.date(Date.UTC(year, month - 1, day, 12), { month: "short", day: "numeric", timeZone: "UTC" }),
      clock(schedule.time),
    );
  } else if (schedule.kind === "weekly") {
    // January 7, 2024 is a Sunday.
    parts.push(format.date(new Date(2024, 0, 7 + schedule.weekday), { weekday: "long" }), clock(schedule.time));
  } else if (schedule.kind === "daily" || schedule.kind === "weekdays" || schedule.kind === "monthly") {
    parts.push(clock(schedule.time));
  }
  if (completed) parts.unshift(t("mobile.server.routines.status.completed"));
  return parts.join(" · ");
}
