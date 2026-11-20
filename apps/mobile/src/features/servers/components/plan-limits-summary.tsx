import { Typography } from "heroui-native";
import { View } from "react-native";
import { PLAN_LIMIT_TONE_TEXT, PlanLimitRing } from "@/features/servers/components/plan-limit-ring";
import {
  lowestPlanLimitsFirst,
  PLAN_LIMIT_RESET_FORMAT,
  planLimitListedWindowLabel,
  planLimitName,
  planLimitResetDate,
  planLimitWindowKey,
  usePlanLimits,
} from "@/features/servers/model/plan-limits";
import { SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";

const RING_SIZE = 34;
const RING_GAP = 12;

export function PlanLimitsSummary({ serverId }: { serverId: string }) {
  const { t, format } = useText();
  const { rows, accounts } = usePlanLimits(serverId);
  if (rows.length === 0) return null;
  return (
    <SettingsSection title={t("mobile.server.planLimits.title")} footer={t("mobile.server.usage.planLimitsNote")}>
      {lowestPlanLimitsFirst(rows).map((row) => (
        <View key={`${row.provider}-${row.accountId ?? ""}`} className="gap-1 px-4 py-3">
          <Typography.Paragraph
            className="font-semibold"
            numberOfLines={1}
            style={{ marginLeft: RING_SIZE + RING_GAP }}
          >
            {planLimitName(row, accounts, t)}
          </Typography.Paragraph>
          <View className="flex-row items-center" style={{ gap: RING_GAP }}>
            <PlanLimitRing row={row} size={RING_SIZE} />
            <View className="min-w-0 flex-1 gap-1">
              {row.listedWindows.map((window, index) => {
                const resetsAt = planLimitResetDate(window);
                return (
                  <View
                    key={planLimitWindowKey(window, index)}
                    className="flex-row flex-wrap items-baseline justify-between gap-x-3"
                  >
                    <Typography
                      type="body-sm"
                      className={PLAN_LIMIT_TONE_TEXT[window.tone]}
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      {t("mobile.server.planLimits.windowLeft", {
                        window: planLimitListedWindowLabel(window, t),
                        percent: window.remainingPercent,
                      })}
                    </Typography>
                    {resetsAt ? (
                      <Typography type="body-xs" className="text-grouped-secondary">
                        {t("mobile.server.planLimits.resetsAt", {
                          time: format.date(resetsAt, PLAN_LIMIT_RESET_FORMAT),
                        })}
                      </Typography>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      ))}
    </SettingsSection>
  );
}
