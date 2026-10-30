import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button, Typography } from "heroui-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession, useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useChannels } from "@/features/channels/components/use-channels";
import { MobileSearchResultRow } from "@/features/search/components/search-result-row";
import {
  MOBILE_SEARCH_FILTERS,
  type MobileSearchFilter,
  type MobileSearchSetting,
  mobileSearchSources,
  mobileSearchView,
  normalizeMobileSearchQuery,
} from "@/features/search/model/mobile-search";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { BlurEnter, BlurSwap, swapItemMotion } from "@/shared/components/blur-swap";
import { haptics } from "@/shared/lib/haptics";
import { useTransitionMode } from "@/shared/lib/motion";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const FILTER_LABEL = {
  all: "mobile.search.filter.all",
  agents: "mobile.search.filter.agents",
  channels: "mobile.search.filter.channels",
  messages: "mobile.search.filter.messages",
  files: "mobile.search.filter.files",
  routines: "mobile.search.filter.routines",
  settings: "mobile.search.filter.settings",
} as const satisfies Record<MobileSearchFilter, MobileTextKey>;

// "Searching…" waits this long, so an answer that comes sooner never shows it.
const SEARCHING_DELAY = 200;

/**
 * Keeps the results of the previous host search while the next one loads, when the user is still
 * typing the same words on the same server. A new word starts with no results, not with old ones.
 */
function continuesSearch(previous: readonly unknown[] | undefined, next: readonly unknown[]): boolean {
  if (!previous || previous.length !== next.length || previous.slice(0, -1).some((part, index) => part !== next[index]))
    return false;
  const before = String(previous.at(-1));
  const now = String(next.at(-1));
  return now.startsWith(before) || before.startsWith(now);
}

/** The pages of the Settings sheet and of the server sheets and screens. They are not the desktop settings. */
function useSearchSettings(channelsSupported: boolean): MobileSearchSetting[] {
  const { t } = useText();
  const serverName = useMobileWorkspace().activeServer.name;
  return useMemo(() => {
    const app = t("mobile.app.route.settings");
    const pages: MobileSearchSetting[] = [
      { id: "profile", title: t("mobile.app.route.profile"), detail: app },
      { id: "sessions", title: t("mobile.app.route.accountSessions"), detail: app },
      { id: "appearance", title: t("mobile.settings.appearance.title"), detail: app },
      { id: "animations", title: t("mobile.settings.animations.title"), detail: app },
      { id: "language", title: t("mobile.settings.language.title"), detail: app },
      { id: "haptics", title: t("mobile.settings.feedback.haptics"), detail: app },
    ];
    if (isIOS)
      pages.push(
        { id: "notifications", title: t("mobile.settings.notifications.title"), detail: app },
        { id: "liveActivities", title: t("mobile.settings.liveActivities.title"), detail: app },
      );
    pages.push(
      { id: "privacy", title: t("mobile.settings.privacy.title"), detail: app },
      { id: "hiddenChats", title: t("mobile.settings.conversations.hiddenChats"), detail: app },
      ...(channelsSupported
        ? [{ id: "deletedChannels" as const, title: t("mobile.app.route.deletedChannels"), detail: serverName }]
        : []),
      { id: "support", title: t("mobile.settings.home.support"), detail: app },
      { id: "about", title: t("mobile.settings.home.about"), detail: app },
      { id: "serverOptions", title: t("mobile.app.route.serverOptions"), detail: serverName },
      { id: "serverMembers", title: t("mobile.app.route.members"), detail: serverName },
      { id: "serverRoutines", title: t("mobile.server.drawer.routines"), detail: serverName },
      { id: "serverUsage", title: t("mobile.server.drawer.usage"), detail: serverName },
    );
    return pages;
  }, [t, serverName, channelsSupported]);
}

/**
 * The results of the home search for `query`: agents and settings on this phone, and the messages,
 * files and routines that the host finds. With no query and no filter, `idle` shows instead.
 * The host searches run only while `active`.
 */
export function MobileSearchResults({
  query,
  active,
  idle,
  onLeave,
}: {
  query: string;
  active: boolean;
  idle: ReactNode;
  /** Runs before a result opens what it names. */
  onLeave: () => void;
}) {
  const { t } = useText();
  const {
    activeAgents,
    activeServer,
    hiddenChannelIds,
    searchMessages,
    canSearchFiles,
    searchFiles,
    loadRoutineCalendar,
  } = useMobileWorkspace();
  const { session } = useMobileSession();
  const queryScope = useQueryScope();
  const serverId = activeServer.id;
  const [filter, setFilter] = useState<MobileSearchFilter>("all");
  const motion = useTransitionMode("searchTransitions");
  const filesSupported = canSearchFiles(serverId);
  const channelState = useChannels(serverId);
  // As on desktop, a server without channels or without file search shows no filter for them.
  const filters = MOBILE_SEARCH_FILTERS.filter(
    (candidate) => (candidate !== "channels" || channelState.supported) && (candidate !== "files" || filesSupported),
  );
  const channels = useMemo(
    () =>
      channelState.supported
        ? channelState.channels.filter((channel) => !channel.archived && !hiddenChannelIds.includes(channel.id))
        : [],
    [channelState.supported, channelState.channels, hiddenChannelIds],
  );
  const agentsById = useMemo(() => new Map(activeAgents.map((agent) => [agent.id, agent])), [activeAgents]);
  const settings = useSearchSettings(channelState.supported);

  // Search the host after typing stops, as the desktop search does, not on each character.
  const [hostQuery, setHostQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setHostQuery(normalizeMobileSearchQuery(query)), 150);
    return () => clearTimeout(timer);
  }, [query]);
  // The host searches run for the query that typing stopped at. The typed query tells what will run.
  const sources = mobileSearchSources(filter, hostQuery);
  const wanted = mobileSearchSources(filter, query);
  const typing = normalizeMobileSearchQuery(query) !== hostQuery;
  const messageKey = queryKeys.messageSearch(queryScope, serverId, hostQuery);
  const messages = useInfiniteQuery({
    queryKey: messageKey,
    queryFn: ({ pageParam }) => searchMessages(hostQuery, serverId, pageParam),
    // An empty cursor asks for the newest matches.
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: (previous, previousQuery) =>
      continuesSearch(previousQuery?.queryKey, messageKey) ? previous : undefined,
    enabled: active && sources.messages,
    retry: false,
  });
  const fileKey = queryKeys.fileSearch(queryScope, serverId, hostQuery);
  const files = useInfiniteQuery({
    queryKey: fileKey,
    queryFn: ({ pageParam }) => searchFiles(hostQuery, serverId, pageParam),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: (previous, previousQuery) =>
      continuesSearch(previousQuery?.queryKey, fileKey) ? previous : undefined,
    enabled: active && filesSupported && sources.files,
    retry: false,
  });
  // The phone already has the agents and channels it shows, so it asks the host only for their routines.
  const routineOwners = useMemo(
    () => [
      ...activeAgents.map((agent) => ({ kind: "agent" as const, agentId: agent.id })),
      ...channels.map((channel) => ({ kind: "channel" as const, channelId: channel.id })),
    ],
    [activeAgents, channels],
  );
  const routineOwnerKey = routineOwners
    .map((owner) => (owner.kind === "agent" ? `a:${owner.agentId}` : `c:${owner.channelId}`))
    .join(",");
  const routines = useQuery({
    // The routine calendar key, so the events that change routines refresh this list too.
    queryKey: queryKeys.serverRoutineSearch(queryScope, serverId, routineOwnerKey),
    queryFn: async () => {
      // A range that starts after now reads no run history, and an empty one places no runs.
      const at = new Date(Date.now() + 60_000).toISOString();
      return (await loadRoutineCalendar({ from: at, to: at }, serverId, routineOwners)).routines;
    },
    // The list does not depend on the query, so it loads at once.
    enabled: active && wanted.routines,
    retry: false,
    staleTime: 60_000,
  });

  const membershipId = activeServer.membershipId;
  const accountUserId = session?.user.id ?? null;
  const messageItems = useMemo(
    () => messages.data?.pages.flatMap((page) => page.results) ?? [],
    [messages.data?.pages],
  );
  const fileItems = useMemo(() => files.data?.pages.flatMap((page) => page.results) ?? [], [files.data?.pages]);
  const messagePageCount = messages.data?.pages.length ?? 0;
  const filePageCount = files.data?.pages.length ?? 0;
  const view = useMemo(
    () =>
      mobileSearchView({
        // Local matches follow each character. The host searches wait for the typing to stop, and the
        // results shown stay until the next ones come.
        query,
        filter,
        reader: { memberId: membershipId || null, accountUserId },
        agents: activeAgents,
        channels,
        settings,
        routines: !wanted.routines
          ? { status: "idle", items: [] }
          : {
              status: routines.data ? "ready" : routines.isError ? "error" : "loading",
              items: routines.data ?? [],
            },
        messages: !wanted.messages
          ? { status: "idle" }
          : {
              status: typing || messages.isFetching ? "loading" : messages.isError ? "error" : "ready",
              items: sources.messages ? messageItems : [],
              hasMore: !typing && messages.hasNextPage,
              pages: messagePageCount,
            },
        files:
          !filesSupported || !wanted.files
            ? { status: "idle" }
            : {
                status: typing || files.isFetching ? "loading" : files.isError ? "error" : "ready",
                items: sources.files ? fileItems : [],
                hasMore: !typing && files.hasNextPage,
                pages: filePageCount,
              },
      }),
    [
      query,
      filter,
      membershipId,
      accountUserId,
      activeAgents,
      channels,
      settings,
      wanted.routines,
      wanted.messages,
      wanted.files,
      typing,
      sources.messages,
      sources.files,
      filesSupported,
      routines.data,
      routines.isError,
      messages.isError,
      messages.isFetching,
      messages.hasNextPage,
      messageItems,
      messagePageCount,
      files.isError,
      files.isFetching,
      files.hasNextPage,
      fileItems,
      filePageCount,
    ],
  );
  const { fetchNextPage: fetchMoreMessages, refetch: refetchMessages } = messages;
  const { fetchNextPage: fetchMoreFiles, refetch: refetchFiles } = files;
  useEffect(() => {
    if (active && view.readOn.messages) void fetchMoreMessages();
  }, [active, view.readOn.messages, fetchMoreMessages]);
  useEffect(() => {
    if (active && view.readOn.files) void fetchMoreFiles();
  }, [active, view.readOn.files, fetchMoreFiles]);
  const retry = () => {
    if (messages.isError) void (messages.isFetchNextPageError ? fetchMoreMessages() : refetchMessages());
    if (files.isError) void (files.isFetchNextPageError ? fetchMoreFiles() : refetchFiles());
    if (routines.isError) void routines.refetch();
  };
  const loadMore = () => void (filter === "files" ? fetchMoreFiles() : fetchMoreMessages());
  const selectFilter = (next: MobileSearchFilter) => {
    if (next === filter || !filters.includes(next)) return;
    void haptics.selection();
    setFilter(next);
  };
  const resultCount = view.sections.reduce((count, section) => count + section.results.length, 0);
  const item = swapItemMotion(motion);
  const showsIdle = filter === "all" && !normalizeMobileSearchQuery(query);
  // Under the results: a host search that still loads, a failed one, or its next page.
  const footer =
    view.state !== "results"
      ? "none"
      : view.loading
        ? "loading"
        : view.failed
          ? "failed"
          : view.canLoadMore
            ? "more"
            : "none";

  const searchSummary = useRef({ used: false, count: 0 });
  if (query.trim()) searchSummary.current = { used: true, count: resultCount };
  useEffect(() => {
    const scope = mobileAnalytics.scope();
    return () => {
      if (searchSummary.current.used)
        scope.track("search_action", {
          scope: "global",
          result: "succeeded",
          result_count: searchSummary.current.count,
        });
    };
  }, []);

  return (
    <>
      {/* A filter names itself above its results, with a way back to all of them. */}
      <BlurSwap swapKey={filter} mode={motion}>
        {filter === "all" ? null : (
          <SearchCaption
            label={t(FILTER_LABEL[filter])}
            action={{ label: t("mobile.search.clearFilter"), onPress: () => selectFilter("all") }}
          />
        )}
      </BlurSwap>
      <BlurSwap
        swapKey={showsIdle ? "idle" : `${filter}:${view.state}`}
        mode={motion}
        enterDelay={!showsIdle && view.state === "loading" ? SEARCHING_DELAY : 0}
      >
        {showsIdle ? (
          idle
        ) : view.state === "results" ? (
          <>
            {view.sections.map((section) => {
              const label = t(FILTER_LABEL[section.key]);
              return (
                <Animated.View
                  key={section.key}
                  entering={item.entering}
                  exiting={item.exiting}
                  layout={item.layout}
                  className="pb-2"
                >
                  {/* The rows of a section that comes in come in with it. */}
                  <BlurEnter mode={motion}>
                    <LayoutAnimationConfig skipEntering>
                      {filter === "all" ? (
                        <SearchCaption
                          label={label}
                          action={
                            section.more
                              ? {
                                  label: t("mobile.search.seeAll"),
                                  accessibilityLabel: t("mobile.search.seeAllLabel", { section: label }),
                                  onPress: () => selectFilter(section.key),
                                }
                              : undefined
                          }
                        />
                      ) : null}
                      {section.results.map((result) => (
                        <Animated.View
                          key={result.id}
                          entering={item.entering}
                          exiting={item.exiting}
                          layout={item.layout}
                        >
                          <MobileSearchResultRow
                            result={result}
                            query={query}
                            serverId={serverId}
                            agents={agentsById}
                            onLeave={onLeave}
                          />
                        </Animated.View>
                      ))}
                    </LayoutAnimationConfig>
                  </BlurEnter>
                </Animated.View>
              );
            })}
            {/* The footer moves with the sections above it. */}
            <Animated.View layout={item.layout}>
              <BlurSwap swapKey={footer} mode={motion} enterDelay={footer === "loading" ? SEARCHING_DELAY : 0}>
                {footer === "loading" ? (
                  <SearchNotice title={t("mobile.search.loading")} />
                ) : footer === "failed" ? (
                  <SearchNotice title={t("mobile.search.failedTitle")} onRetry={retry} />
                ) : footer === "more" ? (
                  <View className="items-center px-8 py-6">
                    <Button size="sm" variant="secondary" onPress={loadMore}>
                      <Button.Label>
                        {filter === "files" ? t("mobile.search.showMoreFiles") : t("mobile.search.showMore")}
                      </Button.Label>
                    </Button>
                  </View>
                ) : null}
              </BlurSwap>
            </Animated.View>
          </>
        ) : view.state === "loading" ? (
          <SearchNotice title={t("mobile.search.loading")} />
        ) : view.state === "error" ? (
          <SearchNotice title={t("mobile.search.failedTitle")} body={t("mobile.search.errorBody")} onRetry={retry} />
        ) : view.state === "hint" ? (
          <SearchNotice title={t("mobile.search.hintTitle")} body={t("mobile.search.hintBody")} />
        ) : (
          <SearchNotice title={t("mobile.search.emptyTitle")} body={t("mobile.search.emptyBody")} />
        )}
      </BlurSwap>
    </>
  );
}

/** The heading of a group of results, as the home list names its sections. */
export function SearchCaption({
  label,
  action,
}: {
  label: string;
  action?: { label: string; accessibilityLabel?: string; onPress: () => void };
}) {
  return (
    // 24 pt above each heading, so the sections read as groups and do not run into each other.
    <View className="flex-row items-center justify-between gap-3 pt-6 pr-3 pb-1.5 pl-5">
      <Typography.Paragraph accessibilityRole="header" className="font-medium text-muted" style={typeScale.caption}>
        {label}
      </Typography.Paragraph>
      {action ? (
        <Button size="sm" variant="ghost" accessibilityLabel={action.accessibilityLabel} onPress={action.onPress}>
          <Button.Label>{action.label}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}

function SearchNotice({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  const { t } = useText();
  return (
    <View className="items-center gap-3 px-8 py-12">
      <View className="items-center gap-1">
        <Typography.Paragraph className="font-semibold" align="center">
          {title}
        </Typography.Paragraph>
        {body ? (
          <Typography.Paragraph align="center" className="text-text-secondary" style={typeScale.preview}>
            {body}
          </Typography.Paragraph>
        ) : null}
      </View>
      {onRetry ? (
        <Button size="sm" variant="secondary" onPress={onRetry}>
          <Button.Label>{t("mobile.search.retry")}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
