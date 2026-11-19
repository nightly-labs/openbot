import type { PlanLimitRow, PlanLimits } from "@openbot/team-client/plan-limits";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { Pressable, View, type ViewStyle } from "react-native";
import { lowestPlanLimitsFirst, planLimitName, planLimitWindowLabel } from "@/features/servers/model/plan-limits";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { END_X } from "@/shared/lib/text-direction";
import { PlanLimitRing } from "./plan-limit-ring";

const RING_SIZE = 30;
const OVERLAP = 8;
const CUTOUT_GAP = 2;
const HEADER_RIPPLE = { borderless: true, radius: 24 } as const;

export function PlanLimitsHeaderButton({
  serverId,
  rows,
  accounts,
  disabled,
  androidGlass,
}: {
  serverId: string;
  rows: readonly PlanLimitRow[];
  accounts: PlanLimits["accounts"];
  disabled: boolean;
  androidGlass: ViewStyle;
}) {
  const { t } = useText();
  const lowest = lowestPlanLimitsFirst(rows);
  const shown = lowest.slice(0, 2);
  const more = lowest.length - shown.length;
  const summary = lowest
    .map((row) => {
      const window = row.windows.find((item) => item.remainingPercent === row.remainingPercent) ?? row.windows[0];
      return `${planLimitName(row, accounts, t)} ${t("mobile.server.planLimits.windowLeft", {
        window: planLimitWindowLabel(window?.durationMins ?? null, t, window?.name),
        percent: row.remainingPercent,
      })}`;
    })
    .join(", ");
  const single = shown.length === 1 && more === 0;
  const content = (
    <View
      className={
        single
          ? isAndroid
            ? "size-10 items-center justify-center"
            : "size-9 items-center justify-center"
          : "h-10 flex-row items-center px-1.5"
      }
    >
      {shown.map((row, index) => (
        <View key={`${row.provider}-${row.accountId ?? ""}`} style={index > 0 ? { marginLeft: -OVERLAP } : undefined}>
          <PlanLimitRing
            row={row}
            size={RING_SIZE}
            cutout={
              index > 0
                ? {
                    cx: END_X === 1 ? OVERLAP - RING_SIZE / 2 : RING_SIZE * 1.5 - OVERLAP,
                    cy: RING_SIZE / 2,
                    r: RING_SIZE / 2 + CUTOUT_GAP,
                  }
                : undefined
            }
          />
        </View>
      ))}
      {more > 0 ? (
        <Typography className="pr-1 pl-1.5 font-semibold text-text-secondary" type="body-sm">
          {t("mobile.server.planLimits.more", { number: more })}
        </Typography>
      ) : null}
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.server.planLimits.button", { summary })}
      accessibilityState={{ disabled }}
      disabled={disabled}
      android_ripple={isAndroid ? HEADER_RIPPLE : undefined}
      className={isAndroid ? "h-12 justify-center rounded-full" : undefined}
      hitSlop={4}
      style={({ pressed }) => (!isAndroid && pressed ? { opacity: 0.6 } : undefined)}
      onPress={() => {
        void haptics.impact("soft");
        router.push({ pathname: "/plan-limits", params: { serverId } });
      }}
    >
      {isAndroid ? (
        <View className="overflow-hidden rounded-full" style={androidGlass}>
          {content}
        </View>
      ) : (
        content
      )}
    </Pressable>
  );
}
