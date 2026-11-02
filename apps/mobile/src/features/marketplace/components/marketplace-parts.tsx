import { Image } from "expo-image";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import CircleCheck from "lucide-react-native/icons/circle-check";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { AvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { CATEGORY_LABELS, KIND_SINGULAR_LABELS, type MarketplaceListing } from "../model/marketplace-listings";
import { ListingGradient } from "./listing-gradient";

/**
 * The picture of a listing: an agent's avatar is round, as in the chat list; an app or a skill has a
 * rounded square, as an app icon. A listing without an image, or one that fails to load, draws the
 * agent's own avatar or the first letter of its name.
 */
export function ListingIcon({ listing, size = 44 }: { listing: MarketplaceListing; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [surface, muted] = useThemeColor(["surface-secondary", "muted"]);
  const radius = listing.kind === "agent" ? size / 2 : Math.round(size * 0.23);
  if (listing.imageUrl && !failed)
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: listing.imageUrl }}
        contentFit="cover"
        recyclingKey={listing.imageUrl}
        style={{ width: size, height: size, borderRadius: radius }}
        onError={() => setFailed(true)}
      />
    );
  if (listing.kind === "agent")
    return <AvatarThumbnail seed={listing.avatarSeed} hue={listing.avatarHue} size={size} />;
  return (
    <View
      className="items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        borderCurve: "continuous",
        backgroundColor: String(surface),
      }}
    >
      <Typography.Paragraph
        style={{ ...typeScale.rowTitle, color: String(muted), fontSize: size * 0.4, lineHeight: size * 0.5 }}
      >
        {listing.name.slice(0, 1).toLocaleUpperCase()}
      </Typography.Paragraph>
    </View>
  );
}

/** The kind and the category of a listing, for the line under its name. */
export function useListingSubtitle(): (listing: MarketplaceListing, showKind: boolean) => string {
  const { t } = useText();
  return (listing, showKind) =>
    [
      showKind ? t(KIND_SINGULAR_LABELS[listing.kind]) : null,
      listing.category ? t(CATEGORY_LABELS[listing.category]) : null,
    ]
      .filter(Boolean)
      .join(" · ");
}

/** One listing in a grouped list. A listing the server has shows a check mark. */
export function ListingRow({
  listing,
  installed,
  showKind,
  onPress,
}: {
  listing: MarketplaceListing;
  installed: boolean;
  showKind: boolean;
  onPress: () => void;
}) {
  const { t } = useText();
  const subtitle = useListingSubtitle()(listing, showKind);
  const success = String(useCSSVariable("--openbot-success-text"));
  return (
    <SettingsRow
      leading={<ListingIcon listing={listing} size={40} />}
      supportingText={[subtitle, listing.description].filter(Boolean).join(" — ")}
      accessibilityLabel={installed ? t("mobile.marketplace.row.installed", { name: listing.name }) : listing.name}
      trailing={installed ? <CircleCheck color={success} size={20} strokeWidth={2} /> : undefined}
      onPress={onPress}
    >
      <Typography.Paragraph numberOfLines={1} style={typeScale.rowTitle}>
        {listing.name}
      </Typography.Paragraph>
    </SettingsRow>
  );
}

/** The text on a listing's gradient: a dark panel, so that white text reads on every palette. */
const ON_GRADIENT = {
  panel: "rgba(0, 0, 0, 0.42)",
  text: "#ffffff",
  secondary: "rgba(255, 255, 255, 0.82)",
  muted: "rgba(255, 255, 255, 0.72)",
};

/**
 * A card of the agent shelf: the agent's gradient with its avatar, as in the banner above it, then the
 * name, two lines about it, and the category and installs on the card's own surface. An agent the
 * server has carries a check mark.
 */
export function AgentCard({
  listing,
  installed,
  onPress,
}: {
  listing: MarketplaceListing;
  installed: boolean;
  onPress: () => void;
}) {
  const { t, format } = useText();
  const success = String(useCSSVariable("--openbot-success-text"));
  const meta = [
    listing.category ? t(CATEGORY_LABELS[listing.category]) : null,
    listing.kind === "app"
      ? null
      : t("mobile.marketplace.overview.installs", { installs: format.compact(listing.installs) }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={installed ? t("mobile.marketplace.row.installed", { name: listing.name }) : listing.name}
      className="w-44 overflow-hidden rounded-grouped bg-grouped"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, borderCurve: "continuous" })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <View className="h-24 items-center justify-center">
        <ListingGradient name={listing.name} />
        <ListingIcon listing={listing} size={60} />
      </View>
      <View className="gap-1 px-3.5 pt-3 pb-3.5">
        <Typography.Paragraph numberOfLines={1} className="font-semibold" style={typeScale.body}>
          {listing.name}
        </Typography.Paragraph>
        <Typography.Paragraph
          numberOfLines={2}
          className="text-grouped-secondary"
          style={{ ...typeScale.caption, minHeight: 36 }}
        >
          {listing.description}
        </Typography.Paragraph>
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <Typography.Paragraph
            numberOfLines={1}
            className="min-w-0 flex-1 text-grouped-secondary"
            style={typeScale.small}
          >
            {meta}
          </Typography.Paragraph>
          {installed ? <CircleCheck color={success} size={16} strokeWidth={2.2} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/** One app of the grid: the icon over its name. An app the server has carries a check mark. */
export function AppTile({
  listing,
  installed,
  onPress,
}: {
  listing: MarketplaceListing;
  installed: boolean;
  onPress: () => void;
}) {
  const { t } = useText();
  const success = String(useCSSVariable("--openbot-success-text"));
  const [background] = useThemeColor(["background"]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={installed ? t("mobile.marketplace.row.installed", { name: listing.name }) : listing.name}
      className="w-1/4 items-center gap-1.5 py-2"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <View>
        <ListingIcon listing={listing} size={54} />
        {installed ? (
          <View className="absolute -top-1 -right-1 rounded-full" style={{ backgroundColor: String(background) }}>
            <CircleCheck color={success} size={18} strokeWidth={2.2} />
          </View>
        ) : null}
      </View>
      <Typography.Paragraph numberOfLines={1} align="center" style={typeScale.small}>
        {listing.name}
      </Typography.Paragraph>
    </Pressable>
  );
}

/**
 * The agent with the most installs, at the top of the overview: its avatar large on the listing's
 * gradient, as on the desktop page, and the name over a dark panel so that the text reads on every
 * palette.
 */
export function FeaturedAgent({
  listing,
  installed,
  onPress,
}: {
  listing: MarketplaceListing;
  installed: boolean;
  onPress: () => void;
}) {
  const { t, format } = useText();
  const installs = listing.kind === "app" ? null : listing.installs;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.marketplace.overview.mostInstalledLabel", { name: listing.name })}
      className="overflow-hidden rounded-3xl"
      style={({ pressed }) => ({ borderCurve: "continuous", opacity: pressed ? 0.85 : 1 })}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <ListingGradient name={listing.name} />
      <View className="px-5 pt-5">
        <View className="self-start rounded-full px-2.5 py-1" style={{ backgroundColor: "rgba(0, 0, 0, 0.28)" }}>
          <Typography.Paragraph className="font-semibold" style={{ ...typeScale.small, color: "#ffffff" }}>
            {t("mobile.marketplace.overview.mostInstalled")}
          </Typography.Paragraph>
        </View>
      </View>
      <View className="items-center pt-2 pb-8">
        <ListingIcon listing={listing} size={108} />
      </View>
      <View className="gap-3 px-5 py-4" style={{ backgroundColor: ON_GRADIENT.panel }}>
        <View className="gap-1">
          <Typography.Heading type="h3" numberOfLines={1} style={{ color: ON_GRADIENT.text }}>
            {listing.name}
          </Typography.Heading>
          <Typography.Paragraph numberOfLines={2} style={{ ...typeScale.preview, color: ON_GRADIENT.secondary }}>
            {listing.description}
          </Typography.Paragraph>
        </View>
        <View className="flex-row items-center justify-between gap-3">
          <Typography.Paragraph
            numberOfLines={1}
            className="min-w-0 flex-1"
            style={{ ...typeScale.caption, color: ON_GRADIENT.muted }}
          >
            {installs === null
              ? listing.creatorName
              : t("mobile.marketplace.overview.featuredMeta", {
                  name: listing.creatorName,
                  installs: format.compact(installs),
                })}
          </Typography.Paragraph>
          <View className="rounded-full bg-white px-4 py-1.5">
            <Typography.Paragraph className="font-semibold" style={{ ...typeScale.preview, color: "#141414" }}>
              {installed ? t("mobile.marketplace.installed") : t("mobile.marketplace.overview.view")}
            </Typography.Paragraph>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
