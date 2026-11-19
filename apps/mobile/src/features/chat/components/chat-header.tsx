import { GlassView } from "expo-glass-effect";
import { router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Trash from "lucide-react-native/icons/trash";
import { memo, useMemo } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import type { ChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useMessagePinsEnabled } from "@/features/chat/components/use-message-pins";
import { useSplitDetailRoot } from "@/features/chat/components/use-split-detail-root";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useColumnWidth, useSplitLayout } from "@/shared/components/adaptive-split";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { toolbarMenuItems } from "@/shared/components/toolbar-menu-items";
import { haptics } from "@/shared/lib/haptics";
import { BAR_BUTTON_SIZE, NATIVE_BAR_BUTTON_TOP, NATIVE_BAR_HEIGHT, useBarTop } from "@/shared/lib/native-bar";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { typeScale } from "@/shared/lib/type-scale";
import { useVerticalBarShown } from "@/shared/lib/vertical-bar";
import type { ChatTarget } from "../model/chat-target";

interface ChatHeaderProps {
  target: ChatTarget;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  liquidGlassAvailable: boolean;
  topInset: number;
  onBack: () => void;
  needsAction?: boolean;
  channelBrowser?: { agentId: string; agentIds: readonly string[]; tabId?: string } | null;
  accessibilityHidden?: boolean;
  title?: string;
  kicker?: string;
  actionsMenu?: { label: string; actions: MenuAction[]; onPressAction: (id: string) => void } | null;
  threadMenu?: ChatThreadMenu;
  deleteAction?: { label: string; disabled: boolean; onPress: () => void };
}

export const ChatHeader = memo(function ChatHeader({
  target,
  fallbackBackground,
  foreground,
  liquidGlassAvailable,
  topInset,
  onBack,
  needsAction = false,
  channelBrowser = null,
  accessibilityHidden = false,
  title,
  kicker,
  actionsMenu,
  threadMenu,
  deleteAction,
}: ChatHeaderProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const width = useColumnWidth();
  const insets = useSafeAreaInsets();
  const splitDetailRoot = useSplitDetailRoot();
  const verticalBar = useVerticalBarShown();
  const barTop = useBarTop();
  const splitShown = useSplitLayout() !== null;
  const warning = useThemeColor("warning");
  const disconnected = useMobileWorkspaceSelector(
    (current) => !current.servers.some((server) => server.id === target.serverId && showsOnline(server)),
  );
  const browserView = useMobileWorkspaceSelector((current) => current.browserViewSupport(target.serverId).view);
  const browserAllowed = useBrowserFeature();
  const browserAgent =
    target.kind === "agent" ? { agentId: target.id, agentIds: [], tabId: undefined } : channelBrowser;
  const plainChat = actionsMenu === undefined && deleteAction === undefined;
  const browserShown = plainChat && browserAllowed && !disconnected && browserView && Boolean(browserAgent);
  const pinsEnabled = useMessagePinsEnabled(target.serverId);
  const pinsShown = plainChat && target.kind === "agent" && pinsEnabled;
  const attention = plainChat && target.kind === "channel" && needsAction;
  const sideQuestionEnabled = useMobileWorkspaceSelector((current) => current.canAskSideQuestion(target.serverId));
  const sideQuestionShown = plainChat && target.kind === "agent" && sideQuestionEnabled;
  const members = useMemo(
    () => new Map(target.kind === "channel" ? target.members.map((member) => [member.id, member]) : []),
    [target],
  );
  const channelPicture = useMemo(
    () =>
      target.kind === "channel"
        ? {
            id: target.id,
            members: target.members.map((member) => ({ agentId: member.id })),
            icon: target.icon,
            imageUrl: target.imageUrl,
          }
        : { members: [] },
    [target],
  );
  const iconColor = String(foreground);
  const identity = (
    <>
      {target.kind === "channel" ? (
        <ChannelAvatar
          channel={channelPicture}
          agents={members}
          size={28}
          serverId={target.serverId}
          disconnected={disconnected}
        />
      ) : (
        <AgentPinAvatar agentId={target.id} location="chat" size={28}>
          <BloubAvatar
            agentId={target.id}
            serverId={target.serverId}
            hue={target.avatarHue}
            color={target.avatarColor}
            seed={target.avatarSeed}
            size={28}
          />
        </AgentPinAvatar>
      )}
      {kicker ? (
        <>
          <Typography.Paragraph className="font-semibold" numberOfLines={1} style={typeScale.rowTitle}>
            {kicker}
          </Typography.Paragraph>
          <View className="size-1 rounded-full bg-muted" />
        </>
      ) : null}
      <Typography.Paragraph className="font-semibold min-w-0 shrink" numberOfLines={1} style={typeScale.rowTitle}>
        {title ?? target.name}
      </Typography.Paragraph>
    </>
  );

  const openBrowser = () => {
    if (!browserAgent) return;
    void haptics.impact("soft");
    router.push({
      pathname: "/browser/[agentId]",
      params: {
        agentId: browserAgent.agentId,
        serverId: target.serverId,
        ...(browserAgent.tabId ? { tabId: browserAgent.tabId } : {}),
        ...(browserAgent.agentIds.length > 1 ? { agentIds: browserAgent.agentIds.join(",") } : {}),
      },
    });
  };
  const openChannelActions = () => {
    void haptics.impact("soft");
    router.push({
      pathname: "/channel-actions/[channelId]",
      params: { channelId: target.id, serverId: target.serverId },
    });
  };
  const openSideQuestion = () => {
    void haptics.impact("soft");
    router.push({ pathname: "/side-question/[agentId]", params: { agentId: target.id, serverId: target.serverId } });
  };
  const openPins = () => {
    void haptics.impact("soft");
    router.push({ pathname: "/pinned-messages", params: { agentId: target.id, serverId: target.serverId } });
  };
  const goBack = () => {
    void haptics.impact("soft");
    onBack();
  };
  const browserAction: MenuAction = { id: "browser", title: t("mobile.browser.open"), image: "globe" };
  const pinsAction: MenuAction = { id: "pins", title: t("mobile.chat.pins.title"), image: "pin" };
  const sideQuestionAction: MenuAction = {
    id: "side-question",
    title: t("mobile.chat.sideQuestion.title"),
    image: "questionmark.bubble",
  };
  const attentionAction: MenuAction = {
    id: "attention",
    title: t("mobile.chat.header.actionsNeeded"),
    titleColor: String(warning),
    image: "exclamationmark.triangle",
    imageColor: String(warning),
  };
  const moreActions: MenuAction[] = [
    ...(browserShown ? [browserAction] : []),
    ...(pinsShown ? [pinsAction] : []),
    ...(sideQuestionShown
      ? [{ id: "side-question-section", title: "", displayInline: true, subactions: [sideQuestionAction] }]
      : []),
    ...(attention ? [{ id: "attention-section", title: "", displayInline: true, subactions: [attentionAction] }] : []),
  ];
  const onMoreAction = (id: string) => {
    if (id === "attention") openChannelActions();
    else if (id === "browser") openBrowser();
    else if (id === "pins") openPins();
    else if (id === "side-question") openSideQuestion();
  };
  const moreLabel = attention ? t("mobile.chat.header.moreAttention") : t("mobile.chat.header.more");
  const moreHidden = moreActions.length === 0;
  const moreButton = (size: number) => (
    <MenuView
      colorScheme={theme === "dark" ? "dark" : "light"}
      actions={moreActions}
      onPressAction={({ nativeEvent }) => onMoreAction(nativeEvent.event)}
    >
      <GlassView
        accessible={!moreHidden}
        accessibilityRole="button"
        accessibilityLabel={moreLabel}
        glassEffectStyle={{
          style: liquidGlassAvailable && !moreHidden ? "regular" : "none",
          animate: true,
          animationDuration: 0.2,
        }}
        isInteractive={liquidGlassAvailable && !moreHidden}
        pointerEvents={moreHidden ? "none" : "auto"}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: liquidGlassAvailable || moreHidden ? "transparent" : fallbackBackground,
          opacity: moreHidden ? 0 : 1,
        }}
      >
        <Ellipsis color={iconColor} size={24} strokeWidth={2} />
        {attention ? (
          <View className="absolute top-2 right-2 size-2 rounded-full" style={{ backgroundColor: String(warning) }} />
        ) : null}
      </GlassView>
    </MenuView>
  );

  const titleReserve = verticalBar ? 32 : 40 + (splitDetailRoot ? 0 : 56) + (actionsMenu === null ? 0 : 56);
  const pillHeight = isIOS && !verticalBar ? NATIVE_BAR_HEIGHT : BAR_BUTTON_SIZE;
  const titlePill = (
    <GlassView
      glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
        borderCurve: "continuous",
        borderRadius: pillHeight / 2,
        flexDirection: "row",
        maxWidth: kicker ? undefined : 220,
        flexShrink: 1,
        overflow: "hidden",
      }}
    >
      {threadMenu ? (
        <MenuView
          colorScheme={theme === "dark" ? "dark" : "light"}
          actions={threadMenu.actions}
          onPressAction={({ nativeEvent }) => threadMenu.onPressAction(nativeEvent.event)}
          style={{ alignSelf: "stretch" }}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              threadMenu.attention > 0
                ? t("mobile.chat.threads.menuAttention", { name: target.name, count: threadMenu.attention })
                : t("mobile.chat.threads.menu", { name: target.name })
            }
            className="min-w-0 flex-row items-center gap-2 pr-3 pl-2.5"
            style={{ height: pillHeight, maxWidth: kicker ? width - insets.left - insets.right - titleReserve : 220 }}
          >
            {identity}
            <ChevronDown color={iconColor} size={16} strokeWidth={2.5} />
            {threadMenu.attention > 0 ? (
              <View
                className="absolute top-1.5 right-2 size-2.5 rounded-full"
                style={{ backgroundColor: threadMenu.color }}
              />
            ) : null}
          </View>
        </MenuView>
      ) : (
        <Pressable
          className="min-w-0 shrink flex-row items-center gap-2 self-stretch pr-4 pl-2.5"
          accessibilityRole="button"
          accessibilityLabel={t("mobile.chat.header.info", { name: target.name })}
          hitSlop={8}
          onPress={() => {
            void haptics.impact("soft");
            if (target.kind === "channel")
              router.push({
                pathname: "/channel-info/[channelId]",
                params: { channelId: target.id, serverId: target.serverId },
              });
            else
              router.push({
                pathname: "/agent-info/[agentId]",
                params: { agentId: target.id, serverId: target.serverId },
              });
          }}
        >
          {identity}
        </Pressable>
      )}
    </GlassView>
  );

  const deleteButton = deleteAction ? (
    <ChatGlassIconButton
      accessibilityLabel={deleteAction.label}
      disabled={deleteAction.disabled}
      fallbackBackground={fallbackBackground}
      liquidGlassAvailable={liquidGlassAvailable}
      onPress={deleteAction.onPress}
    >
      <Trash color={iconColor} size={22} strokeWidth={2} />
    </ChatGlassIconButton>
  ) : null;
  const trailingButtons =
    actionsMenu === null ? null : actionsMenu ? (
      <MenuView
        colorScheme={theme === "dark" ? "dark" : "light"}
        actions={actionsMenu.actions}
        onPressAction={({ nativeEvent }) => actionsMenu.onPressAction(nativeEvent.event)}
      >
        <GlassView
          accessible
          accessibilityRole="button"
          accessibilityLabel={actionsMenu.label}
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          isInteractive
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
          }}
        >
          <Ellipsis color={iconColor} size={24} strokeWidth={2} />
        </GlassView>
      </MenuView>
    ) : (
      moreButton(BAR_BUTTON_SIZE)
    );

  if (isIOS) {
    return (
      <>
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="chevron.backward"
            accessibilityLabel={t("common.back")}
            hidden={splitDetailRoot || accessibilityHidden}
            onPress={goBack}
          />
          {verticalBar ? null : (
            <Stack.Toolbar.View hidesSharedBackground hidden={accessibilityHidden}>
              <View className="flex-row" style={{ height: NATIVE_BAR_HEIGHT }}>
                {titlePill}
              </View>
            </Stack.Toolbar.View>
          )}
        </Stack.Toolbar>
        <Stack.Toolbar placement="right">
          {deleteAction ? (
            <Stack.Toolbar.Button
              icon="trash"
              accessibilityLabel={deleteAction.label}
              disabled={deleteAction.disabled}
              hidden={accessibilityHidden}
              onPress={deleteAction.onPress}
            />
          ) : actionsMenu ? null : !verticalBar ? (
            <Stack.Toolbar.View hidesSharedBackground hidden={accessibilityHidden || moreHidden}>
              <View style={{ width: NATIVE_BAR_HEIGHT, height: NATIVE_BAR_HEIGHT }}>
                {moreButton(NATIVE_BAR_HEIGHT)}
              </View>
            </Stack.Toolbar.View>
          ) : (
            <Stack.Toolbar.Menu
              icon="ellipsis"
              accessibilityLabel={moreLabel}
              hidden={accessibilityHidden || moreHidden}
            >
              {attention ? <Stack.Toolbar.Badge style={{ backgroundColor: String(warning) }} /> : null}
              {toolbarMenuItems(moreActions, onMoreAction)}
            </Stack.Toolbar.Menu>
          )}
          {actionsMenu ? (
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={actionsMenu.label} hidden={accessibilityHidden}>
              {toolbarMenuItems(actionsMenu.actions, actionsMenu.onPressAction)}
            </Stack.Toolbar.Menu>
          ) : null}
        </Stack.Toolbar>
        <SheetScrollEdgeEffect
          style={{ height: topInset + 82, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
        />
        {verticalBar ? (
          <View
            className="absolute z-20 flex-row"
            pointerEvents="box-none"
            accessibilityElementsHidden={accessibilityHidden}
            importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
            style={{ top: barTop, left: insets.left + 16, right: insets.right + 16, height: BAR_BUTTON_SIZE }}
          >
            {titlePill}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <>
      <View
        className="absolute inset-x-0 z-20 flex-row items-center gap-2"
        pointerEvents="box-none"
        accessibilityElementsHidden={accessibilityHidden}
        importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
        style={{
          top: topInset + (splitShown ? NATIVE_BAR_BUTTON_TOP : 8),
          paddingLeft: insets.left + 16,
          paddingRight: insets.right + 16,
        }}
      >
        {splitDetailRoot ? null : (
          <ChatGlassIconButton
            accessibilityLabel={t("common.back")}
            fallbackBackground={fallbackBackground}
            liquidGlassAvailable={liquidGlassAvailable}
            onPress={goBack}
          >
            <ArrowLeft color={iconColor} size={24} strokeWidth={2} style={MIRROR_IN_RTL} />
          </ChatGlassIconButton>
        )}

        {titlePill}

        <View className="flex-1" />
        {deleteButton ?? trailingButtons}
      </View>
      <SheetScrollEdgeEffect
        style={{ height: topInset + 82, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
      />
    </>
  );
});
