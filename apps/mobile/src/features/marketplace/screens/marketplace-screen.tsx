import { router, useLocalSearchParams } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsNote, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { GLASS_CAPSULE_HEIGHT } from "@/shared/components/glass-capsule";
import { LargeTitle, LargeTitleBar, useLargeTitleScroll } from "@/shared/components/large-title";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { AgentCard, AppTile, FeaturedAgent, ListingRow } from "../components/marketplace-parts";
import { MarketplaceSearchBar } from "../components/marketplace-search-bar";
import {
  byPopularity,
  CATEGORY_LABELS,
  isMarketplaceFiltered,
  KIND_LABELS,
  type MarketplaceFilter,
  type MarketplaceKind,
  type MarketplaceListing,
  matchesFilter,
  NO_MARKETPLACE_FILTER,
} from "../model/marketplace-listings";
import { type MarketplaceInstalled, useMarketplaceCatalog, useMarketplaceInstalled } from "../model/use-marketplace";

/** The agents of the shelf and the skills of the list on the overview. */
const OVERVIEW_ROWS = 8;
/** The apps of the grid on the overview: two rows of four. */
const OVERVIEW_APPS = 8;

/**
 * The Marketplace of one server, from the drawer. The overview shows a featured agent, the popular
 * agents, the apps and the popular skills. The field at the bottom searches, and its filter menu
 * narrows the page to one kind, one category, or what the server already has.
 */
export function MarketplaceScreen() {
  const { t } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const server = useMobileWorkspaceSelector((workspace) => workspace.servers.find((item) => item.id === serverId));
  const scroll = useLargeTitleScroll();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<MarketplaceFilter>(NO_MARKETPLACE_FILTER);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const catalog = useMarketplaceCatalog({ query, filter });
  const installed = useMarketplaceInstalled(serverId);
  const title = t("mobile.app.route.marketplace");
  const listing = (item: MarketplaceListing) => {
    // The name goes along, so the sheet has its title before the listing loads.
    router.push({
      pathname: "/marketplace-listing",
      params: { serverId, kind: item.kind, id: item.id, name: item.name },
    });
  };
  const showAll = (kind: MarketplaceKind) => {
    void haptics.selection();
    setFilter({ ...NO_MARKETPLACE_FILTER, kind });
  };
  const listMode = isMarketplaceFiltered(filter) || catalog.search.length > 0;

  // The agents and skills did not load. The bundled apps still show under it, with a way to retry.
  const loadFailed =
    server && catalog.failed ? (
      <View className="items-center gap-3 px-6 py-4">
        <Typography.Paragraph align="center" className="text-grouped-secondary">
          {t("mobile.marketplace.loadFailed")}
        </Typography.Paragraph>
        <Button variant="secondary" onPress={() => void catalog.refetch()}>
          <Button.Label>{t("common.tryAgain")}</Button.Label>
        </Button>
      </View>
    ) : null;
  let content: ReactNode;
  if (!server) content = <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>;
  else if (listMode)
    content = (
      <FilteredList
        listings={catalog.listings.filter((item) => matchesFilter(item, filter, installed.installed))}
        filter={filter}
        pending={catalog.pending}
        installed={installed}
        onOpen={listing}
        onClear={() => {
          void haptics.selection();
          setFilter(NO_MARKETPLACE_FILTER);
          setQuery("");
        }}
      />
    );
  else
    content = (
      <Overview
        listings={catalog.listings}
        pending={catalog.pending}
        installed={installed}
        onOpen={listing}
        onShowAll={showAll}
      />
    );

  return (
    <View className="flex-1 bg-sheet">
      <Animated.ScrollView
        className="flex-1"
        // The side insets go outside the scroll view, as in `LargeTitleScrollView`.
        style={{ marginLeft: insets.left, marginRight: insets.right }}
        contentInsetAdjustmentBehavior={scroll.ownsInset ? "never" : "always"}
        // Android has no content inset, so the content starts below the transparent header. The bottom
        // keeps the last row above the field.
        contentContainerStyle={{
          paddingTop: scroll.ownsInset ? scroll.headerHeight : 0,
          paddingBottom: insets.bottom + GLASS_CAPSULE_HEIGHT + 32,
        }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        onScroll={scroll.onScroll}
      >
        <LargeTitle scroll={scroll} title={title} caption={server?.name} />
        <View className="gap-7 pt-3">
          {loadFailed}
          {content}
        </View>
      </Animated.ScrollView>
      <LargeTitleBar scroll={scroll} title={title} surface="sheet" />
      {server ? (
        <MarketplaceSearchBar
          query={query}
          onQueryChange={setQuery}
          filter={filter}
          onFilterChange={setFilter}
          focused={focused}
          onFocusedChange={setFocused}
        />
      ) : null}
    </View>
  );
}

function SectionHeader({ title, onShowAll }: { title: string; onShowAll?: () => void }) {
  const { t } = useText();
  return (
    <View className="flex-row items-baseline justify-between px-5">
      <Typography.Heading type="h4">{title}</Typography.Heading>
      {onShowAll ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.marketplace.overview.seeAllOf", { name: title })}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
          onPress={onShowAll}
        >
          <Typography.Paragraph className="text-accent-text" style={typeScale.preview}>
            {t("mobile.marketplace.overview.seeAll")}
          </Typography.Paragraph>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A listing's installs. Apps have no install count. */
function installsOf(listing: MarketplaceListing): number {
  return listing.kind === "app" ? 0 : listing.installs;
}

function Overview({
  listings,
  pending,
  installed,
  onOpen,
  onShowAll,
}: {
  listings: MarketplaceListing[];
  pending: boolean;
  installed: MarketplaceInstalled;
  onOpen: (listing: MarketplaceListing) => void;
  onShowAll: (kind: MarketplaceKind) => void;
}) {
  const { t } = useText();
  const agents = listings.filter((item) => item.kind === "agent").sort(byPopularity);
  const apps = listings.filter((item) => item.kind === "app").sort(byPopularity);
  const skills = listings.filter((item) => item.kind === "skill").sort(byPopularity);
  // The banner shows the agent with the most installs, so it follows the catalog as installs change.
  // The catalog page is sorted by installs, so its first page holds the top agent.
  const featured = agents.reduce<MarketplaceListing | undefined>(
    (top, item) => (top === undefined || installsOf(item) > installsOf(top) ? item : top),
    undefined,
  );
  const shelf = agents.filter((item) => item !== featured);
  return (
    <>
      {featured ? (
        <View className="px-4">
          <FeaturedAgent
            listing={featured}
            installed={installed.installed(featured)}
            onPress={() => onOpen(featured)}
          />
        </View>
      ) : null}
      {shelf.length > 0 ? (
        <View className="gap-3">
          <SectionHeader title={t("mobile.marketplace.overview.agents")} onShowAll={() => onShowAll("agent")} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4">
            {shelf.slice(0, OVERVIEW_ROWS).map((item) => (
              <AgentCard
                key={item.id}
                listing={item}
                installed={installed.installed(item)}
                onPress={() => onOpen(item)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View className="gap-1">
        <SectionHeader title={t("mobile.marketplace.overview.apps")} onShowAll={() => onShowAll("app")} />
        <View className="flex-row flex-wrap px-2">
          {apps.slice(0, OVERVIEW_APPS).map((item) => (
            <AppTile key={item.id} listing={item} installed={installed.installed(item)} onPress={() => onOpen(item)} />
          ))}
        </View>
      </View>
      {skills.length > 0 ? (
        <View className="gap-3">
          <SectionHeader title={t("mobile.marketplace.overview.skills")} onShowAll={() => onShowAll("skill")} />
          <View className="px-4">
            <SettingsSection>
              {skills.slice(0, OVERVIEW_ROWS).map((item) => (
                <ListingRow
                  key={item.id}
                  listing={item}
                  installed={installed.installed(item)}
                  showKind={false}
                  onPress={() => onOpen(item)}
                />
              ))}
            </SettingsSection>
          </View>
        </View>
      ) : null}
      {pending && agents.length === 0 && skills.length === 0 ? <Spinner className="self-center" /> : null}
    </>
  );
}

function FilteredList({
  listings,
  filter,
  pending,
  installed,
  onOpen,
  onClear,
}: {
  listings: MarketplaceListing[];
  filter: MarketplaceFilter;
  pending: boolean;
  installed: MarketplaceInstalled;
  onOpen: (listing: MarketplaceListing) => void;
  onClear: () => void;
}) {
  const { t } = useText();
  const parts = [
    filter.kind ? t(KIND_LABELS[filter.kind]) : null,
    filter.category ? t(CATEGORY_LABELS[filter.category]) : null,
    filter.installed ? t("mobile.marketplace.installed") : null,
  ].filter(Boolean);
  return (
    <View className="gap-3 px-4">
      {parts.length > 0 ? (
        <View className="flex-row items-baseline justify-between px-1">
          <Typography.Paragraph
            numberOfLines={1}
            className="min-w-0 flex-1 text-grouped-secondary"
            style={typeScale.preview}
          >
            {parts.join(" · ")}
          </Typography.Paragraph>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onClear}>
            <Typography.Paragraph className="text-accent-text" style={typeScale.preview}>
              {t("mobile.marketplace.filter.clear")}
            </Typography.Paragraph>
          </Pressable>
        </View>
      ) : null}
      {listings.length > 0 ? (
        <SettingsSection>
          {listings.map((item) => (
            <ListingRow
              key={`${item.kind}:${item.id}`}
              listing={item}
              installed={installed.installed(item)}
              showKind={filter.kind === null}
              onPress={() => onOpen(item)}
            />
          ))}
        </SettingsSection>
      ) : pending ? (
        <Spinner className="self-center" />
      ) : (
        <SettingsNote>{t("mobile.marketplace.empty")}</SettingsNote>
      )}
    </View>
  );
}
