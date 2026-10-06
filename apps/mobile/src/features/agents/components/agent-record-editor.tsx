import { Host, Switch } from "@expo/ui";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type CreateRoutineInput,
  isRoutineSchedule,
  type MemoryEntry,
  type RoutineFields,
  type RoutineSchedule,
  type UpdateRoutineInput,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  type RoutineScheduleDraft,
  routineDraftProblemCode,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/team-client/routine-schedule-draft";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
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
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { RoutineScheduleFields } from "./routine-schedule-fields";

const DEFAULT_SCHEDULE: RoutineSchedule = { kind: "daily", time: "09:00" };

function useRecordDraftGuard(dirty: boolean, pending: boolean) {
  const navigation = useNavigation();
  const { t } = useText();
  usePreventRemove(dirty || pending, ({ data }) => {
    if (pending) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });
}

function useRecordAction(
  invalidate: QueryKey = ["agent-info"],
  failure: MobileTextKey = "mobile.agent.record.saveFailed",
) {
  const { t, errorMessage } = useText();
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
      void haptics.notification("success");
      done?.();
      void client.invalidateQueries({ queryKey: invalidate });
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t(failure)));
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
  port,
}: {
  agent: Pick<MobileAgent, "id" | "serverId">;
  memory?: MemoryEntry;
  available: boolean;
  port?: {
    save(text: string, id?: string): Promise<void>;
    delete(id: string): Promise<void>;
    queryKey: QueryKey;
  };
}) {
  const { t } = useText();
  const workspace = useMobileWorkspace();
  const action = useRecordAction(port?.queryKey);
  const [editedText, setEditedText] = useState<string | undefined>();
  const text = editedText ?? memory?.text ?? "";
  const [savedText, setSavedText] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const dirty = text.trim() !== (memory ? memory.text : (savedText ?? ""));
  useRecordDraftGuard(dirty && !finished, action.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || (!memory && savedText !== null);
  return (
    <View className="gap-5">
      <SheetFormField
        label={t("mobile.agent.record.memory")}
        appearance="soft"
        multiline
        value={text}
        editable={!disabled}
        maxLength={INPUT_LIMITS.agentMemoryText}
        onChangeText={(value) => setEditedText(value === (memory?.text ?? "") ? undefined : value)}
      />
      <SheetSaveAction
        dirty={dirty}
        canSave={!disabled && Boolean(text.trim())}
        pending={action.pending}
        onSave={() =>
          void action.run(
            () =>
              port
                ? port.save(text.trim(), memory?.id)
                : workspace.saveAgentMemory(agent.id, text.trim(), agent.serverId, memory?.id),
            () => {
              setSavedText(text.trim());
              if (memory) setEditedText(undefined);
              else setFinished(true);
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
              Alert.alert(t("mobile.agent.record.deleteMemoryTitle"), t("mobile.agent.record.deleteMemoryBody"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.delete"),
                  style: "destructive",
                  onPress: () =>
                    void action.run(
                      () =>
                        port
                          ? port.delete(memory.id)
                          : workspace.deleteAgentMemory(agent.id, memory.id, agent.serverId),
                      () => setFinished(true),
                    ),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.agent.record.deleteMemory")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
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
  port,
}: {
  agent: Pick<MobileAgent, "id" | "serverId">;
  routine?: RoutineFields;
  available: boolean;
  port?: {
    create(input: Omit<CreateRoutineInput, "agentId">): Promise<void>;
    update(input: Omit<UpdateRoutineInput, "agentId">): Promise<void>;
    delete(id: string): Promise<void>;
    test(id: string): Promise<void>;
    queryKey: QueryKey;
  };
}) {
  const { t } = useText();
  const workspace = useMobileWorkspace();
  const action = useRecordAction(port?.queryKey);
  const toggle = useRecordAction(port?.queryKey);
  const testRun = useRecordAction(port?.queryKey, "mobile.agent.record.testFailed");
  const [testStarted, setTestStarted] = useState(false);
  const [activeOverride, setActiveOverride] = useState<boolean | null>(null);
  useEffect(() => {
    if (routine?.active === activeOverride) setActiveOverride(null);
  }, [routine?.active, activeOverride]);
  function toggleActive(active: boolean) {
    if (!routine || toggle.pending || !available) return;
    setActiveOverride(active);
    void toggle.run(async () => {
      try {
        if (port) await port.update({ routineId: routine.id, active });
        else await workspace.updateAgentRoutine({ agentId: agent.id, routineId: routine.id, active }, agent.serverId);
      } catch (cause) {
        setActiveOverride(null);
        throw cause;
      }
    });
  }
  const { theme } = useUniwind();
  const [finished, setFinished] = useState(false);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [edits, setEdits] = useState<{ name?: string; instruction?: string; schedule?: RoutineScheduleDraft }>({});
  const name = edits.name ?? routine?.name ?? "";
  const instruction = edits.instruction ?? routine?.instruction ?? "";
  const savedSchedule = routine?.trigger.schedule ?? DEFAULT_SCHEDULE;
  // The form edits a draft; an untouched schedule saves as it is, so a kind the form cannot show stays.
  const scheduleDraft = edits.schedule ?? routineScheduleToDraft(savedSchedule);
  const scheduleProblem = routineDraftProblemCode(scheduleDraft);
  const schedule = edits.schedule && !scheduleProblem ? routineScheduleFromDraft(edits.schedule) : savedSchedule;
  const setName = (name: string) => setEdits((current) => ({ ...current, name }));
  const setInstruction = (instruction: string) => setEdits((current) => ({ ...current, instruction }));
  const setSchedule = (schedule: RoutineScheduleDraft) => setEdits((current) => ({ ...current, schedule }));
  const [timezone, setTimezone] = useState(routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const initialTimezone = useRef(timezone);
  const draft = JSON.stringify({ name, instruction, schedule: edits.schedule ?? savedSchedule, timezone });
  const nameChanged = name.trim() !== (routine?.name ?? "");
  const instructionChanged = instruction.trim() !== (routine?.instruction ?? "");
  const scheduleChanged =
    edits.schedule !== undefined &&
    (scheduleProblem !== null || JSON.stringify(schedule) !== JSON.stringify(savedSchedule));
  const dirty = routine
    ? nameChanged || instructionChanged || scheduleChanged
    : draft !==
      (savedDraft ??
        JSON.stringify({
          name: "",
          instruction: "",
          schedule: DEFAULT_SCHEDULE,
          timezone: initialTimezone.current,
        }));
  useRecordDraftGuard(dirty && !finished, action.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || (!routine && savedDraft !== null);
  const validTime = scheduleProblem === null && isRoutineSchedule(schedule);
  async function save() {
    if (port) {
      if (routine)
        await port.update({
          routineId: routine.id,
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(instructionChanged ? { instruction: instruction.trim() } : {}),
          ...(scheduleChanged ? { schedule } : {}),
        });
      else await port.create({ name: name.trim(), instruction: instruction.trim(), schedule, timezone, active: true });
      return;
    }
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
        label={t("mobile.agent.record.routineName")}
        placeholder={t("mobile.agent.record.routineNamePlaceholder")}
        value={name}
        editable={!disabled}
        maxLength={INPUT_LIMITS.routineName}
        onChangeText={setName}
      />
      <SheetFormField
        appearance="soft"
        label={t("mobile.agent.record.routineInstructions")}
        placeholder={t(
          port
            ? "mobile.agent.record.channelInstructionsPlaceholder"
            : "mobile.agent.record.agentInstructionsPlaceholder",
        )}
        multiline
        value={instruction}
        editable={!disabled}
        maxLength={INPUT_LIMITS.routineInstruction}
        onChangeText={setInstruction}
      />
      <RoutineScheduleFields
        draft={scheduleDraft}
        disabled={disabled}
        onChange={setSchedule}
        footer={
          routine ? (
            <SettingsRow
              trailing={
                <Typography type="body-sm" className="text-grouped-secondary">
                  {routine.timezone}
                </Typography>
              }
            >
              <Typography.Paragraph>{t("mobile.agent.record.timeZone")}</Typography.Paragraph>
            </SettingsRow>
          ) : null
        }
      />
      {routine?.trigger.schedule.kind === "interval" && edits.schedule === undefined ? (
        <Typography.Paragraph type="body-xs" className="-mt-3 px-4 text-grouped-secondary">
          {t("mobile.agent.record.scheduleKept")}
        </Typography.Paragraph>
      ) : null}
      {!routine ? (
        <SheetFormField
          label={t("mobile.agent.record.timeZone")}
          value={timezone}
          editable={!disabled}
          onChangeText={setTimezone}
        />
      ) : null}
      <SheetSaveAction
        dirty={dirty}
        canSave={!disabled && Boolean(name.trim() && instruction.trim() && timezone.trim()) && validTime}
        pending={action.pending}
        onSave={() =>
          void action.run(save, () => {
            setSavedDraft(draft);
            if (routine) setEdits({});
            else setFinished(true);
          })
        }
      />
      {routine ? (
        <SettingsSection>
          <SettingsRow
            trailing={
              <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                <Switch
                  label={t("mobile.agent.record.enabled")}
                  value={activeOverride ?? routine.active}
                  disabled={disabled || toggle.pending}
                  onValueChange={toggleActive}
                />
              </Host>
            }
          >
            <Typography.Paragraph>{t("mobile.agent.record.routine")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            disabled={disabled || dirty || testRun.pending}
            onPress={() => {
              setTestStarted(false);
              void testRun.run(
                () => (port ? port.test(routine.id) : workspace.testAgentRoutine(agent.id, routine.id, agent.serverId)),
                () => setTestStarted(true),
              );
            }}
          >
            <Typography.Paragraph className="text-accent">
              {t(testRun.pending ? "mobile.agent.record.testStarting" : "mobile.agent.record.testRun")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            disabled={disabled}
            onPress={() =>
              Alert.alert(t("mobile.agent.record.deleteRoutineTitle"), t("mobile.agent.record.deleteRoutineBody"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.delete"),
                  style: "destructive",
                  onPress: () =>
                    void action.run(
                      () =>
                        port
                          ? port.delete(routine.id)
                          : workspace.deleteAgentRoutine(agent.id, routine.id, agent.serverId),
                      () => setFinished(true),
                    ),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.agent.record.deleteRoutine")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {testStarted ? (
        <Typography.Paragraph accessibilityLiveRegion="polite">
          {t("mobile.agent.record.testStarted")}
        </Typography.Paragraph>
      ) : null}
      {testRun.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {testRun.error}
        </Typography.Paragraph>
      ) : null}
      {toggle.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {toggle.error}
        </Typography.Paragraph>
      ) : null}
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {action.error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
