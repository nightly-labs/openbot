import { Host, Picker, Switch } from "@expo/ui";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AgentMemory, isRoutineSchedule, type Routine, type RoutineSchedule } from "@openbot/contracts/ipc";
import { userErrorMessage } from "@openbot/user-errors";
import { useQueryClient } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { RoutineTimePicker } from "./routine-schedule-time";

function useRecordDraftGuard(dirty: boolean, pending: boolean) {
  const navigation = useNavigation();
  usePreventRemove(dirty || pending, ({ data }) => {
    if (pending) return;
    Alert.alert("Discard changes?", "Your changes have not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
}

function useRecordAction() {
  const client = useQueryClient();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>, done?: () => void) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      done?.();
      void client.invalidateQueries({ queryKey: ["agent-info"] });
    } catch (cause) {
      setError(userErrorMessage(cause, "Could not save changes. Try again."));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { pending, error, run };
}

export function MemoryEditor({
  agent,
  memory,
  available,
}: {
  agent: MobileAgent;
  memory?: AgentMemory;
  available: boolean;
}) {
  const workspace = useMobileWorkspace();
  const action = useRecordAction();
  const [text, setText] = useState(memory?.text ?? "");
  const [savedText, setSavedText] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const dirty = text.trim() !== (savedText ?? memory?.text ?? "");
  useRecordDraftGuard(dirty && !finished, action.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || (!memory && savedText !== null);
  return (
    <View className="gap-5">
      <SheetFormField
        label="Memory"
        appearance="soft"
        multiline
        value={text}
        editable={!disabled}
        maxLength={INPUT_LIMITS.agentMemoryText}
        onChangeText={setText}
      />
      <SheetSaveAction
        canSave={!disabled && Boolean(text.trim()) && dirty}
        pending={action.pending}
        saved={savedText !== null && !dirty}
        onSavedHidden={!memory ? () => setFinished(true) : undefined}
        onSave={() =>
          void action.run(
            () => workspace.saveAgentMemory(agent.id, text.trim(), agent.serverId, memory?.id),
            () => {
              setSavedText(text.trim());
            },
          )
        }
      />
      {memory ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={disabled}
            onPress={() =>
              Alert.alert("Delete memory?", "This memory will be removed.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    void action.run(
                      () => workspace.deleteAgentMemory(agent.id, memory.id, agent.serverId),
                      () => setFinished(true),
                    ),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger">Delete memory</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger">
          {action.error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

export function RoutineEditor({
  agent,
  routine,
  available,
}: {
  agent: MobileAgent;
  routine?: Routine;
  available: boolean;
}) {
  const workspace = useMobileWorkspace();
  const action = useRecordAction();
  const toggle = useRecordAction();
  const [activeOverride, setActiveOverride] = useState<boolean | null>(null);
  useEffect(() => {
    if (routine?.active === activeOverride) setActiveOverride(null);
  }, [routine?.active, activeOverride]);
  function toggleActive(active: boolean) {
    if (!routine || toggle.pending || !available) return;
    setActiveOverride(active);
    void toggle.run(async () => {
      try {
        await workspace.updateAgentRoutine({ agentId: agent.id, routineId: routine.id, active }, agent.serverId);
      } catch (cause) {
        setActiveOverride(null);
        throw cause;
      }
    });
  }
  const { theme } = useUniwind();
  const [finished, setFinished] = useState(false);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [edits, setEdits] = useState<{ name?: string; instruction?: string; schedule?: RoutineSchedule }>({});
  const name = edits.name ?? routine?.name ?? "";
  const instruction = edits.instruction ?? routine?.instruction ?? "";
  const schedule = edits.schedule ?? routine?.trigger.schedule ?? { kind: "daily", time: "09:00" };
  const setName = (name: string) => setEdits((current) => ({ ...current, name }));
  const setInstruction = (instruction: string) => setEdits((current) => ({ ...current, instruction }));
  const setSchedule = (schedule: RoutineSchedule) => setEdits((current) => ({ ...current, schedule }));
  const [timezone, setTimezone] = useState(routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const draft = JSON.stringify({ name, instruction, schedule, timezone });
  const nameChanged = name.trim() !== (routine?.name ?? "");
  const instructionChanged = instruction.trim() !== (routine?.instruction ?? "");
  const scheduleChanged =
    JSON.stringify(schedule) !== JSON.stringify(routine?.trigger.schedule ?? { kind: "daily", time: "09:00" });
  const dirty = routine
    ? nameChanged || instructionChanged || scheduleChanged
    : draft !==
      (savedDraft ??
        JSON.stringify({ name: "", instruction: "", schedule: { kind: "daily", time: "09:00" }, timezone }));
  useRecordDraftGuard(dirty && !finished, action.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || (!routine && savedDraft !== null);
  const validTime = isRoutineSchedule(schedule);
  async function save() {
    if (routine)
      await workspace.updateAgentRoutine(
        {
          agentId: agent.id,
          routineId: routine.id,
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(instructionChanged ? { instruction: instruction.trim() } : {}),
          ...(scheduleChanged ? { schedule } : {}),
        },
        agent.serverId,
      );
    else
      await workspace.createAgentRoutine(
        { agentId: agent.id, name: name.trim(), instruction: instruction.trim(), schedule, timezone, active: true },
        agent.serverId,
      );
  }
  return (
    <View className="gap-5">
      <SheetFormField
        appearance="soft"
        label="Routine name"
        value={name}
        editable={!disabled}
        maxLength={INPUT_LIMITS.routineName}
        onChangeText={setName}
      />
      <SheetFormField
        appearance="soft"
        label="Routine instructions"
        multiline
        value={instruction}
        editable={!disabled}
        maxLength={INPUT_LIMITS.routineInstruction}
        onChangeText={setInstruction}
      />
      <SettingsSection>
        <SettingsRow
          trailing={
            <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
              <Picker
                selectedValue={schedule.kind}
                enabled={!disabled}
                onValueChange={(kind) => {
                  if (kind === "daily" || kind === "weekdays") setSchedule({ kind, time: "09:00" });
                  else if (kind === "weekly") setSchedule({ kind, weekday: 1, time: "09:00" });
                  else if (kind === "monthly") setSchedule({ kind, day: 1, time: "09:00" });
                  else if (kind === "hourly") setSchedule({ kind, minute: 0 });
                  else if (kind === "custom") setSchedule({ kind, expression: "0 9 * * *" });
                }}
              >
                <Picker.Item label="Every day" value="daily" />
                <Picker.Item label="Weekdays" value="weekdays" />
                <Picker.Item label="Every hour" value="hourly" />
                <Picker.Item label="Every week" value="weekly" />
                <Picker.Item label="Every month" value="monthly" />
                <Picker.Item label="Custom schedule" value="custom" />
                {schedule.kind === "advanced" || schedule.kind === "interval" ? (
                  <Picker.Item label="Current schedule" value={schedule.kind} />
                ) : null}
              </Picker>
            </Host>
          }
        >
          <Typography.Paragraph>Schedule</Typography.Paragraph>
        </SettingsRow>
        {schedule.kind === "daily" ||
        schedule.kind === "weekdays" ||
        schedule.kind === "weekly" ||
        schedule.kind === "monthly" ? (
          <RoutineTimePicker
            time={schedule.time}
            disabled={disabled}
            onChange={(time) => setSchedule({ ...schedule, time })}
          />
        ) : schedule.kind === "custom" ? (
          <View className="p-4">
            <SheetFormField
              appearance="soft"
              label="Cron expression"
              value={schedule.expression}
              maxLength={INPUT_LIMITS.routineCron}
              editable={!disabled}
              onChangeText={(expression) => setSchedule({ kind: "custom", expression })}
            />
          </View>
        ) : schedule.kind === "hourly" ? null : (
          <SettingsRow>
            <Typography.Paragraph>
              The current schedule is kept unless you select another schedule.
            </Typography.Paragraph>
          </SettingsRow>
        )}
        {schedule.kind === "weekly" ? (
          <SettingsRow
            trailing={
              <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                <Picker
                  selectedValue={schedule.weekday}
                  enabled={!disabled}
                  onValueChange={(weekday) => setSchedule({ ...schedule, weekday })}
                >
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
                    <Picker.Item key={day} label={day} value={index} />
                  ))}
                </Picker>
              </Host>
            }
          >
            <Typography.Paragraph>Day</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {schedule.kind === "monthly" ? (
          <SettingsRow
            trailing={
              <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                <Picker
                  selectedValue={schedule.day}
                  enabled={!disabled}
                  onValueChange={(day) => setSchedule({ ...schedule, day })}
                >
                  {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                    <Picker.Item key={day} label={String(day)} value={day} />
                  ))}
                </Picker>
              </Host>
            }
          >
            <Typography.Paragraph>Day of month</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {schedule.kind === "hourly" ? (
          <SettingsRow
            trailing={
              <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                <Picker
                  selectedValue={schedule.minute}
                  enabled={!disabled}
                  onValueChange={(minute) => setSchedule({ ...schedule, minute })}
                >
                  {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => (
                    <Picker.Item key={minute} label={String(minute).padStart(2, "0")} value={minute} />
                  ))}
                </Picker>
              </Host>
            }
          >
            <Typography.Paragraph>Minute</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {routine ? (
          <SettingsRow
            trailing={
              <Typography type="body-sm" className="text-grouped-secondary">
                {routine.timezone}
              </Typography>
            }
          >
            <Typography.Paragraph>Time zone</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      {!routine ? (
        <SheetFormField label="Time zone" value={timezone} editable={!disabled} onChangeText={setTimezone} />
      ) : null}
      <SheetSaveAction
        canSave={!disabled && dirty && Boolean(name.trim() && instruction.trim() && timezone.trim()) && validTime}
        pending={action.pending}
        saved={savedDraft !== null && !dirty}
        onSavedHidden={!routine ? () => setFinished(true) : undefined}
        onSave={() =>
          void action.run(save, () => {
            setSavedDraft(draft);
            if (routine) setEdits({});
          })
        }
      />
      {routine ? (
        <SettingsSection>
          <SettingsRow
            trailing={
              <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                <Switch
                  label="Enabled"
                  value={activeOverride ?? routine.active}
                  disabled={disabled || toggle.pending}
                  onValueChange={toggleActive}
                />
              </Host>
            }
          >
            <Typography.Paragraph>Routine</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            disabled={disabled}
            onPress={() =>
              Alert.alert("Delete routine?", "This routine will be removed.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    void action.run(
                      () => workspace.deleteAgentRoutine(agent.id, routine.id, agent.serverId),
                      () => setFinished(true),
                    ),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger">Delete routine</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {toggle.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger">
          {toggle.error}
        </Typography.Paragraph>
      ) : null}
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger">
          {action.error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
