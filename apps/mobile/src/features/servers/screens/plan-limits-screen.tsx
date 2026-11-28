import { agentProviderName } from "@openbot/contracts/ipc";
import { type PlanLimitListedWindow, usagePaceRemainingPercent } from "@openbot/team-client/plan-limits";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { LOGO_RATIO, PLAN_LIMIT_TONE_TEXT, PlanLimitRing } from "@/features/servers/components/plan-limit-ring";
import { ProviderMark } from "@/features/servers/components/provider-mark";
import {
  lowestPlanLimitsFirst,
  PLAN_LIMIT_RESET_FORMAT,
  planLimitListedWindowLabel,
  planLimitName,
  planLimitResetDate,
  planLimitWindowKey,
  usePlanLimits,
} from "@/features/servers/model/plan-limits";
import { SettingsContent, SettingsNote, SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

const RING_SIZE = 34;

export function PlanLimitsScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { rows, notReported, accounts, loading } = usePlanLimits(serverId);
  const lowest = lowestPlanLimitsFirst(rows);
  return (
    <SettingsContent>
      {!loading && lowest.length === 0 ? <SettingsNote>{t("mobile.server.planLimits.empty")}</SettingsNote> : null}
      {lowest.map((row) => (
        <SettingsSection key={`${row.provider}-${row.accountId ?? ""}`}>
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <PlanLimitRing row={row} size={RING_SIZE} />
            <Typography.Paragraph className="min-w-0 flex-1 font-semibold" numberOfLines={1}>
              {planLimitName(row, accounts, t)}
            </Typography.Paragraph>
          </View>
          {row.listedWindows.map((window, index) => (
            <PlanLimitWindowRow key={planLimitWindowKey(window, index)} window={window} />
          ))}
        </SettingsSection>
      ))}
      {notReported.map((provider) => (
        <SettingsSection key={provider}>
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <View style={{ width: RING_SIZE, height: RING_SIZE }} className="items-center justify-center">
              <ProviderMark provider={provider} size={Math.round(RING_SIZE * LOGO_RATIO)} />
            </View>
            <Typography.Paragraph className="min-w-0 flex-1 font-semibold" numberOfLines={1}>
              {agentProviderName(provider)}
            </Typography.Paragraph>
            <Typography.Paragraph className="shrink-0 text-grouped-secondary">
              {t("mobile.server.planLimits.notReported")}
            </Typography.Paragraph>
          </View>
        </SettingsSection>
      ))}
    </SettingsContent>
  );
}

function PlanLimitWindowRow({ window }: { window: PlanLimitListedWindow }) {
  const { t, format } = useText();
  const track = String(useThemeColor("foreground"));
  const [success, warning, danger] = useCSSVariable(["--openbot-success", "--openbot-warning", "--openbot-danger"]);
  const fill = { neutral: success, warning, critical: danger }[window.tone];
  const resetsAt = planLimitResetDate(window);
  const pace = usagePaceRemainingPercent(window.durationMins, window.resetsAt, Date.now());
  return (
    <View className="gap-1.5 px-4 py-3">
      <View className="flex-row items-baseline justify-between gap-3">
        <Typography.Paragraph numberOfLines={1} className="shrink">
          {planLimitListedWindowLabel(window, t)}
        </Typography.Paragraph>
        <Typography.Paragraph className={PLAN_LIMIT_TONE_TEXT[window.tone]} style={{ fontVariant: ["tabular-nums"] }}>
          {t("mobile.server.planLimits.left", { percent: window.remainingPercent })}
        </Typography.Paragraph>
      </View>
      <View className="h-1.5 justify-center">
        <View className="h-full overflow-hidden rounded-full">
          <View className="absolute inset-0" style={{ backgroundColor: track, opacity: 0.15 }} />
          <View
            className="h-full rounded-full"
            style={{ width: `${window.remainingPercent}%`, backgroundColor: String(fill) }}
          />
        </View>
        {pace === null ? null : (
          <View
            className="absolute h-2.5 w-0.5 rounded-full"
            style={{ start: `${pace}%`, marginStart: -1, backgroundColor: track }}
          />
        )}
      </View>
      {resetsAt ? (
        <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
          {t("mobile.server.planLimits.resetsAt", { time: format.date(resetsAt, PLAN_LIMIT_RESET_FORMAT) })}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
