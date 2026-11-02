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
import { typeScale } from "@/shared/lib/type-scale";
import type { MarketplaceListing } from "../model/marketplace-listings";
import { ListingGradient } from "./listing-gradient";
import { ListingIcon, useListingSubtitle } from "./marketplace-parts";

/**
 * The add action of a listing sheet, in the native header: `+` to install, or the arrows of an update.
 * A skill or an app that needs a key opens the next page of the sheet from it.
 */
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

/**
 * The top of a listing's sheet: one card on the listing's gradient, as on the desktop page, with its
 * icon, name, creator, kind and category, and what it does under them - an example request for a skill
 * or an app, or the skills an agent brings. A dark scrim keeps the white text readable on every palette.
 */
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

/** The agents a Try can open, and what it does. No agents turns it off. */
export interface TryTargets {
  agents: readonly { id: string; name: string }[];
  onTry: (agentId: string) => void;
}

/**
 * Opens a Try: one agent opens its chat at once, and more agents ask which one, in a native menu. The
 * child is the control the user presses. The menu covers the child, so a row of text keeps its React
 * Native width and wraps.
 */
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

/**
 * An example request, as the chat field writes it: the listing's chip, then the words. With `targets`
 * it has the Try arrow of the desktop card, which puts the request in an agent's message field.
 */
export function HeroRequest({
  listing,
  text,
  targets,
  caption,
}: {
  listing: MarketplaceListing;
  text: string;
  targets?: TryTargets;
  /** Why the arrow is off, such as a skill that no agent has yet. */
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
              <ArrowRight color="#ffffff" size={20} strokeWidth={2.2} />
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

/** Short words on the gradient, such as the skills of an agent. */
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

/**
 * The properties of a listing in a grid of two columns, with hairlines between the cells and the rows:
 * a small label over each value. An odd last property takes the whole row, centred.
 */
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

/** A heading over a block of a listing sheet. */
export function ListingBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2.5">
      <Typography.Heading type="h4">{title}</Typography.Heading>
      {children}
    </View>
  );
}
