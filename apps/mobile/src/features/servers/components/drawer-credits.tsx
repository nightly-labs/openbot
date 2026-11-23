import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { CreditStar } from "@/features/settings/components/credit-star";
import { useCreditsState } from "@/features/settings/model/credits";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const CREDITS_FRESH_MS = 30_000;
const SERVER_SHARE_OPACITY = 0.4;
const MIN_SHARE_WIDTH = 6;
const CREDITS_HREF: Href = "/settings/credits";

interface DrawerCreditsProps {
  serverId: string | null;
  open: boolean;
  onNavigate: (href: Href) => void;
}

export function DrawerCredits({ serverId, open, onNavigate }: DrawerCreditsProps) {
  const { t, format } = useText();
  const credits = useCreditsState();
  const { refetch, dataUpdatedAt } = credits;
  const fill = String(useCSSVariable("--openbot-credit-star-fill"));
  useEffect(() => {
    if (open && Date.now() - dataUpdatedAt > CREDITS_FRESH_MS) void refetch({ cancelRefetch: false });
  }, [dataUpdatedAt, open, refetch]);
  if (!credits.data?.available) return null;
  const state = credits.data;
  const wallet = serverId ? state.servers.find((server) => server.serverId === serverId) : undefined;
  const personal = format.number(state.balance);
  const serverAmount = wallet ? format.number(wallet.balance) : null;
  const accessibilityLabel =
    wallet && serverAmount
      ? t("mobile.server.drawer.credits.label", { personal, server: serverAmount, name: wallet.name })
      : t("mobile.server.drawer.credits.labelPersonal", { personal });
  return (
    <View className="ml-3">
      <View accessibilityElementsHidden className="h-px bg-grouped-border" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={t("mobile.server.drawer.credits.hint")}
        className="pt-3 pb-1"
        hitSlop={4}
        style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
        onPress={() => {
          void haptics.impact("soft");
          onNavigate(CREDITS_HREF);
        }}
      >
        <View className="h-1.5 flex-row gap-0.5 overflow-hidden rounded-full bg-control-active">
          {state.balance > 0 ? (
            <View
              className="rounded-full"
              style={{ flex: state.balance, minWidth: MIN_SHARE_WIDTH, backgroundColor: fill }}
            />
          ) : null}
          {wallet && wallet.balance > 0 ? (
            <View
              className="rounded-full"
              style={{
                flex: wallet.balance,
                minWidth: MIN_SHARE_WIDTH,
                backgroundColor: fill,
                opacity: SERVER_SHARE_OPACITY,
              }}
            />
          ) : null}
        </View>
        <View className="mt-2 flex-row items-center gap-1.5">
          <CreditStar size={14} />
          <Typography.Paragraph className="font-medium" numberOfLines={1} style={typeScale.small}>
            {t("mobile.server.drawer.credits.yours", { amount: personal })}
          </Typography.Paragraph>
          {wallet && serverAmount ? (
            <Typography.Paragraph
              className="ml-auto min-w-0 shrink text-text-secondary"
              numberOfLines={1}
              style={typeScale.small}
            >
              {t("mobile.server.drawer.credits.server", { amount: serverAmount })}
            </Typography.Paragraph>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}
