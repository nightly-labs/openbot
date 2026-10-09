import type { MenuComponentRef } from "@expo/ui/community/menu";
import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { createContext, type PropsWithChildren, useContext, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import Animated, {
  CurvedTransition,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";
import { useAgentChatPreview } from "@/features/agents/components/agent-chat-preview";
import { AgentAndroidMenu, useAgentContextMenu } from "@/features/agents/components/agent-context-menu";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { ChatZoomSource } from "@/features/agents/components/chat-zoom-source";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const PINNED_LAYOUT = LinearTransition.duration(220).easing(EASE_IN_OUT).reduceMotion(ReduceMotion.System);
const PINNED_ITEM_LAYOUT = CurvedTransition.duration(240)
  .easingX(EASE_IN_OUT)
  .easingY(EASE_IN_OUT)
  .reduceMotion(ReduceMotion.System);
const PINNED_ENTER = FadeIn.duration(180).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const PINNED_EXIT = FadeOut.duration(140).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const PINNED_COLUMNS = 4;
const PINNED_PADDING_X = 12;

// The Android menu sizes its child to the child's content, so a full-width label does not truncate.
// The pinned content gets the column width instead. iOS keeps its flexible layout.
const PinnedItemWidthContext = createContext<number | undefined>(undefined);

/** The width of one pinned item on Android. */
export function usePinnedItemWidth(): number | undefined {
  return useContext(PinnedItemWidthContext);
}

export function PinnedAgentsGrid({ agents, children }: PropsWithChildren<{ agents: MobileAgent[] }>) {
  const { width: windowWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState<number>();
  const itemWidth = isAndroid ? ((gridWidth ?? windowWidth) - PINNED_PADDING_X * 2) / PINNED_COLUMNS : undefined;
  return (
    <Animated.View layout={PINNED_LAYOUT}>
      {agents.length > 0 || children ? (
        <Animated.View exiting={PINNED_EXIT} style={{ width: "100%" }}>
          <View
            onLayout={isAndroid ? (event) => setGridWidth(event.nativeEvent.layout.width) : undefined}
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              rowGap: 18,
              paddingHorizontal: PINNED_PADDING_X,
              paddingVertical: 22,
            }}
          >
            <PinnedItemWidthContext.Provider value={itemWidth}>
              {agents.map((agent) => (
                <PinnedAgentItem key={agent.id} agent={agent} />
              ))}
              {children}
            </PinnedItemWidthContext.Provider>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function PinnedAgentItem({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const [background, accent] = useThemeColor(["background", "accent"]);
  const agentContextMenu = useAgentContextMenu(agent);
  const agentChatPreview = useAgentChatPreview(agent);
  const menu = useRef<MenuComponentRef>(null);
  const isUnread = useAgentUnread(agent.id);
  const itemWidth = usePinnedItemWidth();

  const link = (
    <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id } }} asChild>
      <Link.Trigger>
        <ChatLinkPressable
          chatId={agent.id}
          accessibilityLabel={
            agent.title.trim()
              ? t("mobile.agent.list.openPinnedWithTitle", { name: agent.name, title: agent.title.trim() })
              : t("mobile.agent.list.openPinned", { name: agent.name })
          }
          accessibilityRole="button"
          className="w-full items-center gap-2 px-1"
          onPressIn={agentChatPreview.onPressIn}
          onLongPress={isAndroid ? () => menu.current?.show() : undefined}
          style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
        >
          <ChatZoomSource>
            <AgentPinAvatar agentId={agent.id} location="pinned" size={64}>
              <BloubAvatar
                agentId={agent.id}
                serverId={agent.serverId}
                hue={agent.avatarHue}
                seed={agent.avatarSeed}
                size={64}
                animateIdle={false}
              />
              {isUnread ? (
                <View
                  className="absolute right-0 top-0 size-3.5 rounded-full border-2 bg-accent"
                  style={{ borderColor: background, backgroundColor: accent }}
                />
              ) : null}
            </AgentPinAvatar>
          </ChatZoomSource>
          <View className="w-full gap-0.5">
            <Typography.Paragraph
              type="body-xs"
              align="center"
              className="w-full text-text-secondary"
              numberOfLines={1}
            >
              {agent.name}
            </Typography.Paragraph>
            {agent.title.trim() ? (
              <Typography.Paragraph type="body-xs" align="center" className="w-full text-muted" numberOfLines={1}>
                {agent.title.trim()}
              </Typography.Paragraph>
            ) : null}
          </View>
          {agentChatPreview.measurer}
        </ChatLinkPressable>
      </Link.Trigger>
      {agentChatPreview.preview}
      {agentContextMenu}
    </Link>
  );
  return (
    <PinnedChatItem>
      {isAndroid ? (
        <AgentAndroidMenu agent={agent} menuRef={menu} style={{ width: "100%" }}>
          <View style={{ width: itemWidth }}>{link}</View>
        </AgentAndroidMenu>
      ) : (
        link
      )}
    </PinnedChatItem>
  );
}

export function PinnedChatItem({ children }: PropsWithChildren) {
  return (
    <Animated.View
      entering={PINNED_ENTER}
      exiting={PINNED_EXIT}
      layout={PINNED_ITEM_LAYOUT}
      style={{ width: `${100 / PINNED_COLUMNS}%`, alignItems: "center" }}
    >
      {children}
    </Animated.View>
  );
}
