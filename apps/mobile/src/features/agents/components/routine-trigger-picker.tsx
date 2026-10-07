import type { MobileTextKey } from "@openbot/i18n/mobile";
import { ROUTINE_SAVED_DRAFT_KIND_VALUES, type RoutineDraftKind } from "@openbot/team-client/routine-schedule-draft";
import { Typography } from "heroui-native";
import { AlarmClock, Check, ChevronsDownUp, ChevronsUpDown, Webhook } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** What starts a routine: a schedule frequency, or a request to its webhook. */
export type RoutineTriggerChoice = RoutineDraftKind | "webhook";

const TRIGGER_TEXT = {
  once: { title: "mobile.agent.record.repeat.once", description: "mobile.agent.trigger.onceDescription" },
  hourly: { title: "mobile.agent.record.repeat.hourly", description: "mobile.agent.trigger.hourlyDescription" },
  daily: { title: "mobile.agent.record.repeat.daily", description: "mobile.agent.trigger.dailyDescription" },
  weekly: { title: "mobile.agent.record.repeat.weekly", description: "mobile.agent.trigger.weeklyDescription" },
  monthly: { title: "mobile.agent.record.repeat.monthly", description: "mobile.agent.trigger.monthlyDescription" },
  yearly: { title: "mobile.agent.record.repeat.yearly", description: "mobile.agent.trigger.yearlyDescription" },
  custom: { title: "mobile.agent.trigger.custom", description: "mobile.agent.trigger.customDescription" },
  webhook: { title: "mobile.agent.record.trigger.webhook", description: "mobile.agent.trigger.webhookDescription" },
} as const satisfies Record<RoutineTriggerChoice, { title: MobileTextKey; description: MobileTextKey }>;

function TriggerIcon({ choice, color }: { choice: RoutineTriggerChoice; color: string }) {
  const Icon = choice === "webhook" ? Webhook : AlarmClock;
  return <Icon size={20} color={color} strokeWidth={1.75} />;
}

function Divider() {
  return <View className="ml-4 h-px bg-grouped-border" />;
}

function GroupLabel({ children }: { children: string }) {
  return (
    <View className="px-4 pb-1 pt-3">
      <Typography type="body-xs" className="text-grouped-secondary">
        {children}
      </Typography>
    </View>
  );
}

/**
 * The first row of the trigger card: what starts the routine, with one line that tells when it runs.
 * A press shows the choices below it, as on desktop: the schedule frequencies first, then the webhook
 * in its own group. The selected choice has a check.
 */
export function RoutineTriggerPicker({
  value,
  webhook,
  disabled,
  onSelect,
}: {
  value: RoutineTriggerChoice;
  /** False hides the webhook choice, for a host that cannot receive webhooks. */
  webhook: boolean;
  disabled: boolean;
  onSelect: (choice: RoutineTriggerChoice) => void;
}) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent"));
  const [open, setOpen] = useState(false);
  const shown = open && !disabled;
  const Toggle = shown ? ChevronsDownUp : ChevronsUpDown;

  const option = (choice: RoutineTriggerChoice) => (
    <View key={choice}>
      <Divider />
      <SettingsRow
        checked={choice === value}
        disclosure={false}
        leading={<TriggerIcon choice={choice} color={muted} />}
        supportingText={t(TRIGGER_TEXT[choice].description)}
        trailing={choice === value ? <Check size={18} color={accent} strokeWidth={2} /> : null}
        onPress={() => {
          setOpen(false);
          if (choice === value) return;
          void haptics.selection();
          onSelect(choice);
        }}
      >
        <Typography.Paragraph>{t(TRIGGER_TEXT[choice].title)}</Typography.Paragraph>
      </SettingsRow>
    </View>
  );

  return (
    <View>
      <SettingsRow
        disabled={disabled}
        expanded={shown}
        leading={<TriggerIcon choice={value} color={muted} />}
        supportingText={t(TRIGGER_TEXT[value].description)}
        trailing={<Toggle size={18} color={muted} strokeWidth={1.5} />}
        onPress={() => setOpen((current) => !current)}
      >
        <Typography.Paragraph>{t(TRIGGER_TEXT[value].title)}</Typography.Paragraph>
      </SettingsRow>
      {shown ? (
        <>
          <Divider />
          <GroupLabel>{t("mobile.agent.record.schedule")}</GroupLabel>
          {ROUTINE_SAVED_DRAFT_KIND_VALUES.map(option)}
          {webhook ? (
            <>
              <Divider />
              <GroupLabel>{t("mobile.agent.trigger.groupAdvanced")}</GroupLabel>
              {option("webhook")}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
