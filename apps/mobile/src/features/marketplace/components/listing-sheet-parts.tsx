import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import Plus from "lucide-react-native/icons/plus";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useUniwind } from "uniwind";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { CoveringMenuView } from "@/shared/components/covering-menu-view";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { typeScale } from "@/shared/lib/type-scale";
import type { MarketplaceListing } from "../model/marketplace-listings";
import { ListingGradient } from "./listing-gradient";
import { ListingIcon, useListingSubtitle } from "./marketplace-parts";

export function ListingHeaderAction({
  kind,
  hidden,
  pending,
  label,
  onPress,
}: {
  kind: "add" | "update";
  hidden: boolean;
  pending: boolean;
  label: string;
  onPress: () => void;
}) {
  const icon: LucideIcon = kind === "update" ? RotateCw : Plus;
  const press = () => {
    if (hidden || pending) return;
    void haptics.impact("light");
    onPress();
  };
  if (isAndroid)
    return (
      <AndroidHeaderButton
        placement="right"
        icon={icon}
        hidden={hidden}
        disabled={pending}
        accessibilityLabel={label}
        onPress={press}
      />
    );
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        hidden={hidden}
        disabled={pending}
        icon={isIOS ? (kind === "update" ? "arrow.clockwise" : "plus") : undefined}
        accessibilityLabel={label}
        onPress={press}
      >
        {isIOS ? label : "+"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}

export function ListingHeader({ listing, children }: { listing: MarketplaceListing; children?: ReactNode }) {
  const { t } = useText();
  const subtitle = useListingSubtitle()(listing, true);
  return (
    <View className="overflow-hidden rounded-3xl" style={{ borderCurve: "continuous" }}>
      <Stack.Screen options={{ title: listing.name }} />
      <ListingGradient name={listing.name} />
      <View className="absolute inset-0" style={{ backgroundColor: "rgba(0, 0, 0, 0.16)" }} />
      <View className="items-center gap-4 px-4 pt-7 pb-5">
        <ListingIcon listing={listing} size={88} />
        <View className="items-center gap-1 px-2">
          <Typography.Heading type="h3" align="center" numberOfLines={2} style={{ color: "#ffffff" }}>
            {listing.name}
          </Typography.Heading>
          <Typography.Paragraph
            align="center"
            numberOfLines={2}
            style={{ ...typeScale.caption, color: "rgba(255, 255, 255, 0.85)" }}
          >
            {[t("mobile.marketplace.listing.creator", { name: listing.creatorName }), subtitle].join(" · ")}
          </Typography.Paragraph>
        </View>
        {children ? <View className="self-stretch">{children}</View> : null}
      </View>
    </View>
  );
}

export interface TryTargets {
  agents: readonly { id: string; name: string }[];
  onTry: (agentId: string) => void;
}

export function TryPressable({
  targets,
  label,
  children,
}: {
  targets: TryTargets;
  label: string;
  children: ReactNode;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const [only] = targets.agents;
  if (targets.agents.length > 1)
    return (
      <CoveringMenuView
        colorScheme={theme === "dark" ? "dark" : "light"}
        title={t("mobile.marketplace.try.choose")}
        actions={targets.agents.map((agent): MenuAction => ({ id: agent.id, title: agent.name }))}
        onPressAction={({ nativeEvent }) => targets.onTry(nativeEvent.event)}
        accessibilityLabel={label}
      >
        {children}
      </CoveringMenuView>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !only }}
      disabled={!only}
      style={({ pressed }) => ({ opacity: !only ? 0.4 : pressed ? 0.6 : 1 })}
      onPress={() => {
        if (only) targets.onTry(only.id);
      }}
    >
      {children}
    </Pressable>
  );
}

export function HeroRequest({
  listing,
  text,
  targets,
  caption,
}: {
  listing: MarketplaceListing;
  text: string;
  targets?: TryTargets;
  caption?: string | null;
}) {
  const { t } = useText();
  const only = targets?.agents.length === 1 ? targets.agents[0] : undefined;
  const label = only ? t("mobile.marketplace.try.in", { name: only.name }) : t("mobile.marketplace.try.label");
  return (
    <View className="gap-3">
      <View
        className="flex-row items-end gap-3 rounded-2xl py-3.5 pr-3 pl-4"
        style={{ backgroundColor: "rgba(20, 20, 20, 0.86)", borderCurve: "continuous" }}
      >
        <View className="min-w-0 flex-1 gap-2">
          <View
            className="flex-row items-center gap-1.5 self-start rounded-lg py-1 pr-2 pl-1"
            style={{ backgroundColor: "rgba(66, 160, 255, 0.18)" }}
          >
            <ListingIcon listing={listing} size={18} />
            <Typography.Paragraph numberOfLines={1} style={{ ...typeScale.caption, color: "#7cbcff" }}>
              {listing.name}
            </Typography.Paragraph>
          </View>
          <Typography.Paragraph style={{ ...typeScale.body, color: "#ffffff" }}>{text}</Typography.Paragraph>
        </View>
        {targets ? (
          <TryPressable targets={targets} label={label}>
            <View
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(255, 255, 255, 0.14)" }}
            >
              <ArrowRight color="#ffffff" size={20} strokeWidth={2.2} style={MIRROR_IN_RTL} />
            </View>
          </TryPressable>
        ) : null}
      </View>
      {caption ? (
        <Typography.Paragraph align="center" style={{ ...typeScale.caption, color: "rgba(255, 255, 255, 0.9)" }}>
          {caption}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

export function HeroChips({ items }: { items: readonly string[] }) {
  return (
    <View className="flex-row flex-wrap justify-center gap-2">
      {items.map((item) => (
        <View key={item} className="rounded-full px-3 py-1.5" style={{ backgroundColor: "rgba(20, 20, 20, 0.62)" }}>
          <Typography.Paragraph numberOfLines={1} style={{ ...typeScale.caption, color: "#ffffff" }}>
            {item}
          </Typography.Paragraph>
        </View>
      ))}
    </View>
  );
}

export function ListingFacts({ facts }: { facts: readonly { label: string; value: string }[] }) {
  const rows: (typeof facts)[] = [];
  for (let index = 0; index < facts.length; index += 2) rows.push(facts.slice(index, index + 2));
  return (
    <View>
      {rows.map((row, index) => (
        <View key={row.map((fact) => fact.label).join("|")}>
          {index > 0 ? <View className="h-px bg-grouped-border" /> : null}
          <View className="flex-row">
            {row.map((fact, cell) => (
              <View key={fact.label} className="flex-1 flex-row">
                {cell > 0 ? <View className="my-3 w-px bg-grouped-border" /> : null}
                <View
                  accessible
                  accessibilityLabel={`${fact.label}: ${fact.value}`}
                  className="flex-1 items-center gap-0.5 px-2 py-3"
                >
                  <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-grouped-secondary">
                    {fact.label}
                  </Typography.Paragraph>
                  <Typography.Paragraph numberOfLines={1} className="font-semibold" style={typeScale.body}>
                    {fact.value}
                  </Typography.Paragraph>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function ListingBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2.5">
      <Typography.Heading type="h4">{title}</Typography.Heading>
      {children}
    </View>
  );
}
