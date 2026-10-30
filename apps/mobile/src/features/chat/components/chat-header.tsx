import { GlassView } from "expo-glass-effect";
import { Link, router, Stack } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Globe from "lucide-react-native/icons/globe";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { useMemo, useState } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import type { ChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useSplitDetailRoot } from "@/features/chat/components/use-split-detail-root";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { useColumnWidth, useSplitLayout } from "@/shared/components/adaptive-split";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { ToolbarMenuItems } from "@/shared/components/toolbar-menu-items";
import { haptics } from "@/shared/lib/haptics";
import { BAR_BUTTON_SIZE, NATIVE_BAR_BUTTON_TOP, useBarTop } from "@/shared/lib/native-bar";
import { useText } from "@/shared/lib/text";
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
  /** A channel task needs the user: the header shows the button that opens the channel actions. */
  needsAction?: boolean;
  /**
   * The member whose browser the browser button of a channel opens, the tab of its request, and the
   * members whose browser the browser screen can switch to. Null hides the button.
   */
  channelBrowser?: { agentId: string; agentIds: readonly string[]; tabId?: string } | null;
  /** Something covers the header, such as the voice mode, so screen readers skip it. */
  accessibilityHidden?: boolean;
  /** Shown next to the avatar in place of the agent's name, such as a task title. */
  title?: string;
  /** Shown before the title with a dot between them, such as "Task". */
  kicker?: string;
  /**
   * A menu in place of the browser button, such as the actions of a task. Its actions go to the
   * native bar menu when iOS shows the vertical bar. Null keeps the place empty, as for a task that
   * has not loaded.
   */
  actionsMenu?: { label: string; actions: MenuAction[]; onPressAction: (id: string) => void } | null;
  /** The agent's threads. The agent's name then opens this menu, and the menu has the agent's info. */
  threadMenu?: ChatThreadMenu;
}

export function ChatHeader({
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
}: ChatHeaderProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const width = useColumnWidth();
  const insets = useSafeAreaInsets();
  const splitDetailRoot = useSplitDetailRoot();
  const verticalBar = useVerticalBarShown();
  const barTop = useBarTop();
  // The vertical bar turns the native header on, and an option stays set after its `Stack.Screen`
  // unmounts. Once the bar has shown in this chat, the drawn header turns the native one off again.
  const [nativeHeaderUsed, setNativeHeaderUsed] = useState(false);
  if (verticalBar && !nativeHeaderUsed) setNativeHeaderUsed(true);
  const splitShown = useSplitLayout() !== null;
  const warning = useThemeColor("warning");
  const disconnected = useMobileWorkspaceSelector(
    (current) => !current.servers.some((server) => server.id === target.serverId && showsOnline(server)),
  );
  const browserView = useMobileWorkspaceSelector((current) => current.browserViewSupport(target.serverId).view);
  const browserAllowed = useBrowserFeature();
  // A channel opens the browser of one member: the browser is the browser of an agent.
  const browserAgent =
    target.kind === "agent" ? { agentId: target.id, agentIds: [], tabId: undefined } : channelBrowser;
  const browserShown =
    actionsMenu === undefined && browserAllowed && !disconnected && browserView && Boolean(browserAgent);
  const members = useMemo(
    () => new Map(target.kind === "channel" ? target.members.map((member) => [member.id, member]) : []),
    [target],
  );
  const iconColor = String(foreground);
  const identity = (
    <>
      <Link.AppleZoomTarget>
        {target.kind === "channel" ? (
          <View collapsable={false}>
            <ChannelAvatar
              channel={{ members: target.members.map((member) => ({ agentId: member.id })) }}
              agents={members}
              size={28}
              disconnected={disconnected}
            />
          </View>
        ) : (
          <AgentPinAvatar agentId={target.id} location="chat" size={28}>
            <BloubAvatar
              agentId={target.id}
              serverId={target.serverId}
              hue={target.avatarHue}
              seed={target.avatarSeed}
              size={28}
            />
          </AgentPinAvatar>
        )}
      </Link.AppleZoomTarget>
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
  const goBack = () => {
    void haptics.impact("soft");
    onBack();
  };

  const titlePill = (
    <GlassView
      glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
        borderCurve: "continuous",
        borderRadius: 24,
        flexDirection: "row",
        // A kicker and a title need the width up to the trailing button.
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
          {/* The native menu sizes its trigger to the content, so the title gets the width it can use. */}
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              threadMenu.attention > 0
                ? t("mobile.chat.threads.menuAttention", { name: target.name, count: threadMenu.attention })
                : t("mobile.chat.threads.menu", { name: target.name })
            }
            className="h-12 min-w-0 flex-row items-center gap-2 pr-3 pl-2.5"
            style={{ maxWidth: kicker ? width - insets.left - insets.right - 144 : 220 }}
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
      <View className="flex-row items-center gap-2">
        {target.kind === "channel" && needsAction ? (
          <ChatGlassIconButton
            accessibilityLabel={t("mobile.chat.header.actionsNeeded")}
            fallbackBackground={fallbackBackground}
            liquidGlassAvailable={liquidGlassAvailable}
            onPress={openChannelActions}
          >
            <TriangleAlert color={String(warning)} size={24} strokeWidth={2.5} />
          </ChatGlassIconButton>
        ) : null}
        {/* Not in a BlurReveal: glass stops rendering under an ancestor with zero opacity, so the
          button hides itself, and its glass turns off with the native animation. The agent's
          browser on the host, live. The button shows when the agent has no tab yet too: the
          browser screen opens a new one. A host that cannot stream a tab, or an app version
          the account server has the browser off for, shows no button. */}
        <ChatGlassIconButton
          accessibilityLabel={t("mobile.browser.open")}
          fallbackBackground={fallbackBackground}
          hidden={!browserShown}
          liquidGlassAvailable={liquidGlassAvailable}
          onPress={openBrowser}
        >
          <Globe color={iconColor} size={24} strokeWidth={2} />
        </ChatGlassIconButton>
      </View>
    );

  if (verticalBar) {
    // iOS moves native bar buttons into the vertical bar of iPhone Duo, beside the status bar, as on
    // home. The header becomes the native bar for that: Back and the buttons go to the vertical bar.
    // iOS hides a custom view of the top bar while the content scrolls, so the title is not one: it
    // stays drawn at the top, where the empty top bar closed.
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: true,
            headerBackVisible: false,
            scrollEdgeEffects: { top: "hidden" },
            title: "",
          }}
        />
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="chevron.left"
            accessibilityLabel={t("common.back")}
            hidden={splitDetailRoot || accessibilityHidden}
            onPress={goBack}
          />
        </Stack.Toolbar>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="exclamationmark.triangle"
            accessibilityLabel={t("mobile.chat.header.actionsNeeded")}
            tintColor={String(warning)}
            hidden={accessibilityHidden || !(target.kind === "channel" && needsAction)}
            onPress={openChannelActions}
          />
          <Stack.Toolbar.Button
            icon="globe"
            accessibilityLabel={t("mobile.browser.open")}
            hidden={accessibilityHidden || !browserShown}
            onPress={openBrowser}
          />
          {actionsMenu ? (
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel={actionsMenu.label} hidden={accessibilityHidden}>
              <ToolbarMenuItems actions={actionsMenu.actions} onPressAction={actionsMenu.onPressAction} />
            </Stack.Toolbar.Menu>
          ) : null}
        </Stack.Toolbar>
        <SheetScrollEdgeEffect
          style={{ height: topInset + 82, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
        />
        <View
          className="absolute z-20 flex-row"
          pointerEvents="box-none"
          accessibilityElementsHidden={accessibilityHidden}
          importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
          style={{ top: barTop, left: insets.left + 16, right: insets.right + 16, height: BAR_BUTTON_SIZE }}
        >
          {titlePill}
        </View>
      </>
    );
  }

  return (
    <>
      {nativeHeaderUsed ? <Stack.Screen options={{ headerShown: false }} /> : null}
      <View
        className="absolute inset-x-0 z-20 flex-row items-center gap-2"
        pointerEvents="box-none"
        accessibilityElementsHidden={accessibilityHidden}
        importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
        // The side insets keep the buttons clear of the iPhone Duo rail and of the landscape cutout.
        // Beside the chat list pane, the buttons line up with the native bar buttons of the screens
        // around it. A phone keeps them 8 pt under the status bar.
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
            <ArrowLeft color={iconColor} size={24} strokeWidth={2} />
          </ChatGlassIconButton>
        )}

        {titlePill}

        <View className="flex-1" />
        {trailingButtons}
      </View>
      <SheetScrollEdgeEffect
        style={{ height: topInset + 82, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
      />
    </>
  );
}
