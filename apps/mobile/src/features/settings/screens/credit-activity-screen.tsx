import { creditsFromTenths, creditTenths } from "@openbot/contracts/credits";
import { useFocusEffect } from "expo-router";
import { Typography } from "heroui-native";
import { useCallback } from "react";
import { type TextStyle, View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { CreditActivityDays } from "@/features/settings/components/credit-activity-list";
import { SettingsContent } from "@/features/settings/components/settings-content";
import { useCreditActivity, useCreditsState } from "@/features/settings/model/credits";
import { useText } from "@/shared/lib/text";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STAT_VALUE: TextStyle = { fontSize: 20, lineHeight: 26, letterSpacing: -0.2, fontVariant: ["tabular-nums"] };

export function CreditActivityScreen() {
  const { t, format } = useText();
  const signedIn = useMobileSession().session !== null;
  const credits = useCreditsState();
  const available = credits.data?.available === true;
  const activity = useCreditActivity(available);
  const { refetch } = activity;
  useFocusEffect(
    useCallback(() => {
      if (signedIn && available) void refetch({ cancelRefetch: false });
    }, [available, refetch, signedIn]),
  );
  const entries = activity.data?.entries;
  if (!credits.data || !entries) {
    const failed = activity.isError || credits.isError;
    return (
      <SettingsContent>
        <Typography.Paragraph
          align="center"
          className={failed ? "px-4 pt-10 text-danger-text" : "px-4 pt-10 text-text-secondary"}
        >
          {failed ? t("mobile.settings.credits.activity.loadFailed") : t("mobile.settings.credits.activity.loading")}
        </Typography.Paragraph>
      </SettingsContent>
    );
  }
  const since = Date.now() - WEEK_MS;
  const recent = entries.filter((entry) => entry.at >= since);
  const usedTenths = recent
    .filter((entry) => entry.kind === "generation" && entry.credits < 0)
    .reduce((total, entry) => total - creditTenths(entry.credits), 0);
  const moves = recent.filter((entry) => entry.kind === "move" && entry.credits < 0).length;
  return (
    <SettingsContent>
      <View className="flex-row gap-3">
        <WeekStat
          label={t("mobile.settings.credits.activity.usedWeek")}
          value={format.number(creditsFromTenths(usedTenths))}
        />
        <WeekStat label={t("mobile.settings.credits.activity.movesWeek")} value={format.number(moves)} />
      </View>
      {entries.length === 0 ? (
        <Typography.Paragraph align="center" className="px-4 text-grouped-secondary">
          {t("mobile.settings.credits.activity.empty")}
        </Typography.Paragraph>
      ) : (
        <CreditActivityDays state={credits.data} entries={entries} footer={t("mobile.settings.credits.footer")} />
      )}
    </SettingsContent>
  );
}

function WeekStat({ label, value }: { label: string; value: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      className="flex-1 gap-1 rounded-grouped bg-grouped px-4 py-3"
    >
      <Typography type="body-xs" className="text-grouped-secondary">
        {label}
      </Typography>
      <Typography className="font-sans font-bold" style={STAT_VALUE}>
        {value}
      </Typography>
    </View>
  );
}
