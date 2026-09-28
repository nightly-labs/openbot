import { useQuery } from "@tanstack/react-query";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Search } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { MobileSearchResultRow } from "@/features/search/components/search-result-row";
import { MobileSearchTextInput } from "@/features/search/components/search-text-input";
import type { MobileSearchTextInputHandle } from "@/features/search/components/search-text-input.types";
import { mobileSearchView, normalizeMobileSearchQuery } from "@/features/search/model/mobile-search";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { useText } from "@/shared/lib/text";

export function SearchAgentsScreen() {
  const { t } = useText();
  const { activeAgents, activeServer, searchMessages } = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const [query, setQuery] = useState("");
  const [muted, fieldBackground] = useThemeColor(["muted", "default"]);
  const liquidGlassAvailable = isLiquidGlassAvailable();
  const input = useRef<MobileSearchTextInputHandle>(null);
  // Search the host after typing stops, as the desktop search does, not on each character.
  const [messageQuery, setMessageQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setMessageQuery(normalizeMobileSearchQuery(query)), 150);
    return () => clearTimeout(timer);
  }, [query]);
  const messages = useQuery({
    queryKey: ["message-search", session?.apiUrl, session?.user.id, sessionScope, activeServer.id, messageQuery],
    queryFn: () => searchMessages(messageQuery, activeServer.id),
    enabled: messageQuery !== "",
    retry: false,
  });
  const view = useMemo(
    () =>
      mobileSearchView({
        query,
        agents: activeAgents,
        messages: !messageQuery
          ? { status: "idle" }
          : messages.isError
            ? { status: "error" }
            : messages.data
              ? { status: "ready", page: messages.data }
              : { status: "loading" },
      }),
    [activeAgents, query, messageQuery, messages.data, messages.isError],
  );
  const resultCount = view.state === "results" ? view.results.length : 0;

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
    <SheetScrollView
      contentContainerClassName="pb-safe-offset-5"
      contentInsetAdjustmentBehavior="automatic"
      header={
        <View className="flex-row items-center gap-2 px-5 pb-3 pt-7">
          <GlassView
            glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
            isInteractive={liquidGlassAvailable}
            style={{
              backgroundColor: liquidGlassAvailable ? "transparent" : fieldBackground,
              borderCurve: "continuous",
              borderRadius: 24,
              flex: 1,
              height: 48,
              overflow: "hidden",
            }}
          >
            {/* The field is shorter than the capsule, so a tap anywhere on the capsule focuses it. */}
            <Pressable
              accessible={false}
              className="h-12 flex-row items-center gap-2 px-4"
              onPress={() => input.current?.focus()}
            >
              <Search color={String(muted)} size={19} strokeWidth={2} />
              <MobileSearchTextInput ref={input} value={query} onChangeText={setQuery} />
            </Pressable>
          </GlassView>
        </View>
      }
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {view.state === "results" ? (
        <>
          {view.results.map((result) => (
            <MobileSearchResultRow key={result.id} result={result} />
          ))}
          {view.messages === "loading" ? (
            <SearchNotice title={t("mobile.search.searching")} />
          ) : view.messages === "error" ? (
            <SearchNotice title={t("mobile.search.errorTitle")} onRetry={() => void messages.refetch()} />
          ) : null}
        </>
      ) : view.state === "loading" ? (
        <SearchNotice title={t("mobile.search.searching")} />
      ) : view.state === "error" ? (
        <SearchNotice
          title={t("mobile.search.errorTitle")}
          body={t("mobile.search.errorBody")}
          onRetry={() => void messages.refetch()}
        />
      ) : (
        <SearchNotice title={t("mobile.search.emptyTitle")} body={t("mobile.search.emptyBody")} />
      )}
    </SheetScrollView>
  );
}

function SearchNotice({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  const { t } = useText();
  return (
    <View className="items-center gap-3 px-8 py-12">
      <View className="items-center gap-1">
        <Typography.Paragraph align="center" weight="semibold">
          {title}
        </Typography.Paragraph>
        {body ? (
          <Typography.Paragraph type="body-xs" align="center" className="text-text-secondary">
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
