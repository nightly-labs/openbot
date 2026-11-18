import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Children, createContext, memo, type PropsWithChildren, useContext, useMemo, useState } from "react";
import { View } from "react-native";
import Animated, {
  CurvedTransition,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";
import { useAgentChatPreview } from "@/features/agents/components/agent-chat-preview";
import { AgentAndroidMenu, AgentContextMenuLink } from "@/features/agents/components/agent-context-menu";
import { type AgentListRevealState, AgentListRowReveal } from "@/features/agents/components/agent-list-reveal";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AgentUnreadBadge } from "@/features/agents/components/agent-unread-badge";
import { AGENT_WAIT_STATE, AgentWaitBadge } from "@/features/agents/components/agent-wait-badge";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import {
  AgentDragPreview,
  ChatDragArea,
  PIN_AREA_KEY,
  useChatDrag,
  useChatDropTarget,
  useHoldMenu,
} from "@/features/agents/components/chat-drag";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import {
  agentListWaitReason,
  useAgentListActivity,
  useAgentListUnreadCount,
  useAgentListUnreadThreads,
} from "@/features/workspace/components/use-agent-activity";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { agentActivityMood } from "@/features/workspace/model/agent-activity";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

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
const TILE_REVEAL_STYLE = { width: "100%", alignItems: "center" } as const;

/** The place of one tile in the list reveal: the tiles come in left to right, before the rows. */
const PinnedRevealContext = createContext<{ reveal: AgentListRevealState; index: number } | null>(null);

function PinnedReveal({
  reveal,
  index,
  children,
}: PropsWithChildren<{ reveal: AgentListRevealState | undefined; index: number }>) {
  const value = useMemo(() => (reveal ? { reveal, index } : null), [reveal, index]);
  return <PinnedRevealContext.Provider value={value}>{children}</PinnedRevealContext.Provider>;
}

/**
 * The pinned agents, then `children`: the pinned channels. `animateLayout` false stops the grid from
 * animating to a new place, while something above it changes height on every frame. With `reveal`,
 * the tiles take the list reveal places from `revealOffset` on.
 */
export function PinnedAgentsGrid({
  agents,
  animateLayout = true,
  dropZone = false,
  reveal,
  revealOffset = 0,
  children,
}: PropsWithChildren<{
  agents: MobileAgent[];
  animateLayout?: boolean;
  /** Shows an empty place for a new pin, while the user drags a chat and nothing is pinned. */
  dropZone?: boolean;
  reveal?: AgentListRevealState;
  revealOffset?: number;
}>) {
  const dropTarget = useChatDropTarget(PIN_AREA_KEY);
  return (
    <Animated.View layout={animateLayout ? PINNED_LAYOUT : undefined}>
      {agents.length > 0 || children ? (
        <Animated.View exiting={PINNED_EXIT} style={{ width: "100%" }}>
          <View
            ref={dropTarget}
            collapsable={false}
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              rowGap: 18,
              paddingHorizontal: PINNED_PADDING_X,
              paddingTop: 14,
              paddingBottom: 18,
            }}
          >
            {agents.map((agent, index) => (
              <PinnedReveal key={agent.id} reveal={reveal} index={revealOffset + index}>
                <PinnedAgentItem agent={agent} />
              </PinnedReveal>
            ))}
            {Children.map(children, (child, index) => (
              <PinnedReveal reveal={reveal} index={revealOffset + agents.length + index}>
                {child}
              </PinnedReveal>
            ))}
          </View>
        </Animated.View>
      ) : dropZone ? (
        <PinDropZone dropTarget={dropTarget} />
      ) : null}
    </Animated.View>
  );
}

function PinDropZone({ dropTarget }: { dropTarget: ReturnType<typeof useChatDropTarget> }) {
  const { t } = useText();
  const [border] = useThemeColor(["border"]);
  return (
    <Animated.View entering={PINNED_ENTER} exiting={PINNED_EXIT} style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      <View
        ref={dropTarget}
        collapsable={false}
        className="h-24 items-center justify-center rounded-3xl border-2"
        style={{ borderColor: border, borderStyle: "dashed" }}
      >
        <Typography.Paragraph className="text-muted" style={typeScale.caption}>
          {t("mobile.agent.drag.pinHere")}
        </Typography.Paragraph>
      </View>
    </Animated.View>
  );
}

const PinnedAgentItem = memo(function PinnedAgentItem({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const agentChatPreview = useAgentChatPreview(agent);
  // Each long press mounts the Android menu again, so it opens even if an earlier one did not close.
  const [menuKey, setMenuKey] = useState(0);
  const drag = useChatDrag("pin", () => ({
    chat: { kind: "agent", id: agent.id },
    pinned: true,
    name: agent.name,
    preview: <AgentDragPreview agent={agent} />,
  }));
  const holdMenu = useHoldMenu(drag, () => setMenuKey((key) => key + 1));
  const unreadCount = useAgentListUnreadCount(agent.id);
  const unreadThreads = useAgentListUnreadThreads(agent.id);
  // The tile reads the activity once and gives it to the avatar and the badge.
  const activity = useAgentListActivity(agent.id);
  const waitReason = agentListWaitReason(activity);

  const openLabel = agent.title.trim()
    ? t("mobile.agent.list.openPinnedWithTitle", { name: agent.name, title: agent.title.trim() })
    : t("mobile.agent.list.openPinned", { name: agent.name });
  const trigger = (
    <ChatLinkPressable
      chatId={agent.id}
      accessibilityLabel={
        waitReason
          ? t("mobile.agent.list.withState", { label: openLabel, state: t(AGENT_WAIT_STATE[waitReason]) })
          : unreadCount > 0 || unreadThreads
            ? t("mobile.agent.list.withState", {
                label: openLabel,
                state:
                  unreadCount > 0
                    ? t("mobile.agent.list.unread", { count: unreadCount })
                    : t("mobile.agent.list.unreadThreads"),
              })
            : openLabel
      }
      accessibilityRole="button"
      className="w-full items-center gap-2 px-1"
      onPressIn={agentChatPreview.onPressIn}
      delayLongPress={longPressDelay}
      onLongPress={holdMenu.onLongPress}
      onPressOut={holdMenu.onPressOut}
      style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
    >
      <AgentPinAvatar agentId={agent.id} location="pinned" size={64}>
        <BloubAvatar
          agentId={agent.id}
          serverId={agent.serverId}
          hue={agent.avatarHue}
          color={agent.avatarColor}
          seed={agent.avatarSeed}
          avatarUrl={agent.avatarUrl}
          size={64}
          animateIdle={false}
          rings
          activityMood={agentActivityMood(activity)}
        />
        {/* As on the desktop, a wait outranks the unread count in the corner of the avatar. */}
        {waitReason ? (
          <AgentWaitBadge reason={waitReason} size={22} />
        ) : unreadCount > 0 || unreadThreads ? (
          <AgentUnreadBadge count={unreadCount} avatarSize={64} />
        ) : null}
      </AgentPinAvatar>
      <View className="w-full gap-0.5">
        <Typography.Paragraph
          align="center"
          className="w-full text-text-secondary"
          numberOfLines={1}
          style={typeScale.small}
        >
          {agent.name}
        </Typography.Paragraph>
        {agent.title.trim() ? (
          <Typography.Paragraph align="center" className="w-full text-muted" numberOfLines={1} style={typeScale.small}>
            {agent.title.trim()}
          </Typography.Paragraph>
        ) : null}
      </View>
      {agentChatPreview.measurer}
    </ChatLinkPressable>
  );
  return (
    <PinnedChatItem>
      <ChatDragArea drag={drag} fill>
        {isAndroid ? (
          <View className="w-full">
            <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id } }} asChild>
              <Link.Trigger>{trigger}</Link.Trigger>
            </Link>
            {menuKey > 0 ? <AgentAndroidMenu key={menuKey} agent={agent} onClose={() => setMenuKey(0)} /> : null}
          </View>
        ) : (
          <AgentContextMenuLink agent={agent} preview={agentChatPreview.preview}>
            {trigger}
          </AgentContextMenuLink>
        )}
      </ChatDragArea>
    </PinnedChatItem>
  );
});

export function PinnedChatItem({ children }: PropsWithChildren) {
  const place = useContext(PinnedRevealContext);
  return (
    <Animated.View
      entering={PINNED_ENTER}
      exiting={PINNED_EXIT}
      layout={PINNED_ITEM_LAYOUT}
      style={{ width: `${100 / PINNED_COLUMNS}%`, alignItems: "center" }}
    >
      {place ? (
        <AgentListRowReveal index={place.index} reveal={place.reveal} style={TILE_REVEAL_STYLE}>
          {children}
        </AgentListRowReveal>
      ) : (
        children
      )}
    </Animated.View>
  );
}
