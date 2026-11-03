import { canAdministerServer, type RoutineSchedule, type WorkflowTriggerType } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  type RoutineScheduleDraft,
  routineDraftProblemCode,
  routineScheduleFromDraft,
  routineScheduleToDraft,
  switchDraftKind,
} from "@openbot/team-client/routine-schedule-draft";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useCSSVariable } from "uniwind";
import { RoutineScheduleFields } from "@/features/agents/components/routine-schedule-fields";
import { RoutineTriggerPicker } from "@/features/agents/components/routine-trigger-picker";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { DiscordTriggerFields } from "@/features/workflows/components/workflow-discord-fields";
import { GitHubTriggerFields } from "@/features/workflows/components/workflow-github-fields";
import { TelegramTriggerFields } from "@/features/workflows/components/workflow-telegram-fields";
import { useWorkflowDetail, useWorkflowGitHubSupported } from "@/features/workflows/model/use-workflows";
import { useWorkflowDraft } from "@/features/workflows/model/workflow-draft";
import { GITHUB_TRIGGER_DEFAULTS } from "@/features/workflows/model/workflow-github";
import { triggerType } from "@/features/workflows/model/workflow-steps";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/** The schedule that a new schedule trigger starts with, as on desktop. */
const NEW_SCHEDULE: RoutineSchedule = { kind: "daily", time: "09:00" };

const CHOICES = [
  { type: "manual", title: "mobile.workflow.trigger.manual", description: "mobile.workflow.trigger.manualHint" },
  { type: "schedule", title: "mobile.workflow.trigger.schedule", description: "mobile.workflow.trigger.scheduleHint" },
  { type: "webhook", title: "mobile.workflow.trigger.webhook", description: "mobile.workflow.trigger.webhookHint" },
] as const satisfies readonly TriggerChoice[];

interface TriggerChoice {
  type: WorkflowTriggerType;
  title: MobileTextKey;
  description: MobileTextKey;
}

const GITHUB_CHOICE: TriggerChoice = {
  type: "github",
  title: "mobile.workflow.trigger.github",
  description: "mobile.workflow.trigger.githubHint",
};
const MESSAGE_CHOICE: TriggerChoice = {
  type: "message",
  title: "mobile.workflow.trigger.message",
  description: "mobile.workflow.trigger.messageHint",
};
const DISCORD_CHOICE: TriggerChoice = {
  type: "discord",
  title: "mobile.workflow.trigger.discord",
  description: "mobile.workflow.discord.triggerComputerOnly",
};
const TELEGRAM_CHOICE: TriggerChoice = {
  type: "telegram",
  title: "mobile.workflow.trigger.telegram",
  description: "mobile.workflow.telegram.triggerComputerOnly",
};

const SLACK_CHOICE: TriggerChoice = {
  type: "slack",
  title: "mobile.workflow.trigger.slack",
  description: "mobile.workflow.discord.triggerComputerOnly",
};

/** The editor sheet > Trigger: what starts the workflow, and its schedule or webhook. */
export function WorkflowTriggerScreen() {
  const { t } = useText();
  const { nodeId } = useLocalSearchParams<{ nodeId: string }>();
  const accent = String(useCSSVariable("--openbot-accent"));
  const draft = useWorkflowDraft((state) => state.draft);
  const { setFields, setSchedule, setTriggerProblem } = useWorkflowDraft.getState();
  const node = draft?.graph.nodes.find((item) => item.id === nodeId);
  const saved = useWorkflowDetail(draft?.serverId ?? "", draft?.workflowId ?? "");
  const admin = useMobileWorkspaceSelector((current) =>
    canAdministerServer(current.servers.find((server) => server.id === draft?.serverId)?.role),
  );
  const githubSupported = useWorkflowGitHubSupported(draft?.serverId ?? "");
  const { rotateWorkflowWebhookSecret } = useMobileWorkspaceActions();
  const [schedule, setScheduleDraft] = useState<RoutineScheduleDraft>(() =>
    routineScheduleToDraft(node?.schedule ?? NEW_SCHEDULE),
  );
  // The page starts from the last valid schedule, so a problem from an earlier visit is gone.
  useEffect(() => setTriggerProblem(false), [setTriggerProblem]);
  if (!draft || !node)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.workflow.step.gone")}</SettingsNote>
      </SettingsContent>
    );
  const type = triggerType(node);
  const editable = draft.mode !== "read-only";
  const timezone = typeof node.fields.timezone === "string" && node.fields.timezone ? node.fields.timezone : null;
  const savedTrigger = saved.data?.triggers.find((state) => state.nodeId === node.id);

  const choose = (next: WorkflowTriggerType) => {
    if (next === type) return;
    void haptics.selection();
    // A new GitHub trigger stores the fields that its rows show, as on desktop. A Discord, Telegram or Slack
    // trigger also keeps an `event`, so a change from it writes the defaults again.
    const githubDefaults =
      next === "github" &&
      (node.fields.event === undefined || type === "discord" || type === "telegram" || type === "slack")
        ? GITHUB_TRIGGER_DEFAULTS
        : {};
    setFields(node.id, {
      trigger: next,
      ...githubDefaults,
      // A schedule needs a time zone; a trigger without one runs in the zone of the server.
      ...(next === "schedule" && !timezone ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
    });
    if (next === "schedule") {
      setSchedule(node.id, routineDraftProblemCode(schedule) ? NEW_SCHEDULE : routineScheduleFromDraft(schedule));
    } else {
      setSchedule(node.id, undefined);
      setTriggerProblem(false);
    }
  };
  const changeSchedule = (next: RoutineScheduleDraft) => {
    setScheduleDraft(next);
    const problem = routineDraftProblemCode(next) !== null;
    setTriggerProblem(problem);
    if (!problem) setSchedule(node.id, routineScheduleFromDraft(next));
  };
  const makeSecret = async () => {
    if (!draft.workflowId) return;
    const text = currentText();
    try {
      const { secret } = await rotateWorkflowWebhookSecret(
        { workflowId: draft.workflowId, nodeId: node.id },
        draft.serverId,
      );
      void haptics.notification("success");
      Alert.alert(text.t("mobile.workflow.webhook.secretTitle"), secret, [
        { text: text.t("mobile.workflow.webhook.copySecret"), onPress: () => void Clipboard.setStringAsync(secret) },
        { text: text.t("common.done"), style: "cancel" },
      ]);
    } catch (error) {
      void haptics.notification("error");
      Alert.alert(
        text.t("mobile.workflow.webhook.secretFailed"),
        text.errorMessage(error, text.t("mobile.workflow.alert.tryAgain")),
      );
    }
  };

  const webhookSaved = Boolean(draft.workflowId) && savedTrigger?.type === "webhook";
  const webhookNote = !webhookSaved
    ? t("mobile.workflow.webhook.saveFirst")
    : admin
      ? t("mobile.workflow.webhook.secretHint")
      : t("mobile.workflow.webhook.adminOnly");
  const webhookSection =
    savedTrigger?.webhookUrl || (admin && webhookSaved) ? (
      <SettingsSection title={t("mobile.workflow.webhook.title")} footer={webhookNote}>
        {savedTrigger?.webhookUrl ? (
          <SettingsRow
            supportingText={savedTrigger.webhookUrl}
            onPress={() => {
              const url = savedTrigger.webhookUrl;
              if (url) void Clipboard.setStringAsync(url).then(() => haptics.notification("success"));
            }}
          >
            <Typography.Paragraph>{t("mobile.workflow.detail.copyWebhook")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {admin && webhookSaved ? (
          <SettingsRow disclosure={false} onPress={() => void makeSecret()}>
            <Typography.Paragraph className="text-accent-text">
              {t("mobile.workflow.webhook.newSecret")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    ) : (
      <SettingsNote>{webhookNote}</SettingsNote>
    );

  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.workflow.trigger.startsWhen")}>
        {[
          ...CHOICES,
          // Only an owner or admin adds a GitHub trigger, on a host that runs it, as on desktop.
          ...((admin && githubSupported) || type === "github" ? [GITHUB_CHOICE] : []),
          ...(type === "message" ? [MESSAGE_CHOICE] : []),
          // Only the computer that runs OpenBot has the Discord servers the Telegram chats and the Slack workspaces.
          ...(type === "discord" ? [DISCORD_CHOICE] : []),
          ...(type === "telegram" ? [TELEGRAM_CHOICE] : []),
          ...(type === "slack" ? [SLACK_CHOICE] : []),
        ].map((choice) => (
          <SettingsRow
            key={choice.type}
            checked={choice.type === type}
            disclosure={false}
            // A change to or from a GitHub, Discord, Telegram or Slack trigger needs an owner or admin.
            disabled={
              !editable ||
              choice.type === "message" ||
              choice.type === "discord" ||
              choice.type === "telegram" ||
              choice.type === "slack" ||
              (!admin &&
                (choice.type === "github" ||
                  type === "github" ||
                  type === "discord" ||
                  type === "telegram" ||
                  type === "slack"))
            }
            supportingText={t(choice.description)}
            trailing={choice.type === type ? <Check size={18} color={accent} strokeWidth={2} /> : null}
            onPress={() => choose(choice.type)}
          >
            <Typography.Paragraph>{t(choice.title)}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {type === "schedule" ? (
        <>
          <RoutineScheduleFields
            draft={schedule}
            disabled={!editable}
            header={
              <RoutineTriggerPicker
                value={schedule.kind}
                webhook={false}
                disabled={!editable}
                onSelect={(choice) => {
                  if (choice !== "webhook") changeSchedule(switchDraftKind(schedule, choice, new Date()));
                }}
              />
            }
            onChange={changeSchedule}
          />
          <SettingsNote>
            {timezone
              ? t("mobile.workflow.trigger.timezone", { zone: timezone })
              : t("mobile.workflow.trigger.serverZone")}
          </SettingsNote>
        </>
      ) : null}
      {type === "webhook" ? webhookSection : null}
      {type === "github" ? <GitHubTriggerFields node={node} draft={draft} /> : null}
      {type === "discord" ? <DiscordTriggerFields node={node} /> : null}
      {type === "telegram" ? <TelegramTriggerFields node={node} /> : null}
    </SettingsContent>
  );
}
