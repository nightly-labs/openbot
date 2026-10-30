import type { PlanLimitTone, PlanLimitWindow } from "@openbot/team-client/plan-limits";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { PlanLimitRing } from "@/features/servers/components/plan-limit-ring";
import {
  planLimitName,
  planLimitWindowKey,
  planLimitWindowLabel,
  usePlanLimits,
} from "@/features/servers/model/plan-limits";
import { SettingsContent, SettingsNote, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

const TONE_TEXT = {
  neutral: "",
  warning: "text-warning-text",
  critical: "text-danger-text",
} as const satisfies Record<PlanLimitTone, string>;

const RESET_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };

/** The limits of every provider of a server, the provider with the least left first. */
export function PlanLimitsScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { rows, accounts, loading } = usePlanLimits(serverId);
  const lowest = [...rows].sort((left, right) => left.remainingPercent - right.remainingPercent);
  return (
    <SettingsContent>
      {!loading && lowest.length === 0 ? <SettingsNote>{t("mobile.server.planLimits.empty")}</SettingsNote> : null}
      {lowest.map((row) => (
        <SettingsSection key={`${row.provider}-${row.accountId ?? ""}`}>
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <PlanLimitRing row={row} size={34} />
            <Typography.Paragraph className="min-w-0 flex-1 font-semibold" numberOfLines={1}>
              {planLimitName(row, accounts, t)}
            </Typography.Paragraph>
          </View>
          {row.windows.map((window, index) => (
            <PlanLimitWindowRow key={planLimitWindowKey(window, index)} window={window} />
          ))}
        </SettingsSection>
      ))}
    </SettingsContent>
  );
}

function PlanLimitWindowRow({ window }: { window: PlanLimitWindow }) {
  const { t, format } = useText();
  const track = String(useThemeColor("foreground"));
  const [success, warning, danger] = useCSSVariable(["--openbot-success", "--openbot-warning", "--openbot-danger"]);
  const fill = { neutral: success, warning, critical: danger }[window.tone];
  const resetsAt = window.resetsAt === null ? null : new Date(window.resetsAt * 1_000);
  return (
    <View className="gap-1.5 px-4 py-3">
      <View className="flex-row items-baseline justify-between gap-3">
        <Typography.Paragraph numberOfLines={1} className="shrink">
          {planLimitWindowLabel(window.durationMins, t)}
        </Typography.Paragraph>
        <Typography.Paragraph className={TONE_TEXT[window.tone]} style={{ fontVariant: ["tabular-nums"] }}>
          {t("mobile.server.planLimits.left", { percent: window.remainingPercent })}
        </Typography.Paragraph>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full">
        {/* The track of the desktop rings: the text colour, faint. */}
        <View className="absolute inset-0" style={{ backgroundColor: track, opacity: 0.15 }} />
        <View
          className="h-full rounded-full"
          style={{ width: `${window.remainingPercent}%`, backgroundColor: String(fill) }}
        />
      </View>
      {resetsAt && !Number.isNaN(resetsAt.getTime()) ? (
        <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
          {t("mobile.server.planLimits.resetsAt", { time: format.date(resetsAt, RESET_FORMAT) })}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
