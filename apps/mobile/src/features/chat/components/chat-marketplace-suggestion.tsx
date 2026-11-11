import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Store from "lucide-react-native/icons/store";
import { View, type ViewStyle } from "react-native";
import { MOBILE_PLUGINS } from "@/features/marketplace/model/plugin-catalog.generated";
import { CONNECTOR_TITLE_KEYS, isMobileConnectorId } from "@/features/servers/model/connectors";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * A Marketplace app that an agent suggested, as the desktop card. A catalog app opens its listing,
 * where the person installs or connects it. Another app, such as a connector, keeps the marker.
 */
export function ChatMarketplaceSuggestion({
  appId,
  serverId,
  muted,
}: {
  appId: string;
  serverId: string;
  muted: ViewStyle["backgroundColor"];
}) {
  const { t } = useText();
  const [iconColor] = useThemeColor(["muted"]);
  const plugin = MOBILE_PLUGINS.find((candidate) => candidate.slug === appId);
  if (!plugin) {
    const name = isMobileConnectorId(appId) ? t(CONNECTOR_TITLE_KEYS[appId]) : appId;
    return (
      <View accessible className="flex-row flex-wrap items-center justify-center gap-1.5 py-2">
        <Store size={16} color={String(muted)} strokeWidth={1.75} />
        <Typography.Paragraph type="body-sm" style={{ color: muted }}>
          {t("mobile.chat.marketplaceSuggestion.marker")}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-sm" className="font-medium" style={{ color: muted }}>
          {name}
        </Typography.Paragraph>
      </View>
    );
  }
  const open = () => {
    void haptics.selection();
    // The name goes along, so the sheet has its title before the listing loads, as from the Marketplace.
    router.push({
      pathname: "/marketplace-listing",
      params: { serverId, kind: "app", id: plugin.slug, name: plugin.name },
    });
  };
  return (
    <View
      className="max-w-[88%] self-start gap-2.5 rounded-[30px] bg-control/60 px-4 py-3"
      style={{ borderCurve: "circular" }}
    >
      <View className="flex-row items-center gap-2.5">
        <Store color={String(iconColor)} size={18} strokeWidth={2} />
        <View className="min-w-0 shrink">
          <Typography.Paragraph weight="semibold" accessibilityRole="header" numberOfLines={1}>
            {plugin.name}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={2}>
            {plugin.tagline}
          </Typography.Paragraph>
        </View>
      </View>
      <Button
        size="sm"
        className="self-start"
        accessibilityLabel={t("mobile.chat.marketplaceSuggestion.openNamed", { name: plugin.name })}
        onPress={open}
      >
        <Button.Label>{t("mobile.chat.marketplaceSuggestion.open")}</Button.Label>
      </Button>
    </View>
  );
}
