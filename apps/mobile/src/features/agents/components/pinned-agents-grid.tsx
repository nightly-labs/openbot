import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { memo, type PropsWithChildren, useState } from "react";
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
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AGENT_WAIT_STATE, AgentWaitBadge } from "@/features/agents/components/agent-wait-badge";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { ChatZoomSource } from "@/features/agents/components/chat-zoom-source";
import { useAgentWaitReason } from "@/features/workspace/components/use-agent-activity";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
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

/**
 * The pinned agents, then `children`: the pinned channels. `animateLayout` false stops the grid from
 * animating to a new place, while something above it changes height on every frame.
 */
export function PinnedAgentsGrid({
  agents,
  animateLayout = true,
  children,
}: PropsWithChildren<{ agents: MobileAgent[]; animateLayout?: boolean }>) {
  return (
    <Animated.View layout={animateLayout ? PINNED_LAYOUT : undefined}>
      {agents.length > 0 || children ? (
        <Animated.View exiting={PINNED_EXIT} style={{ width: "100%" }}>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              rowGap: 18,
              paddingHorizontal: PINNED_PADDING_X,
              paddingTop: 14,
              paddingBottom: 18,
            }}
          >
            {agents.map((agent) => (
              <PinnedAgentItem key={agent.id} agent={agent} />
            ))}
            {children}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const PinnedAgentItem = memo(function PinnedAgentItem({ agent }: { agent: MobileAgent }) {
  const { t } = useText();
  const [background, accent] = useThemeColor(["background", "accent"]);
  const agentChatPreview = useAgentChatPreview(agent);
  // Each long press mounts the Android menu again, so it opens even if an earlier one did not close.
  const [menuKey, setMenuKey] = useState(0);
  const isUnread = useAgentUnread(agent.id);
  const waitReason = useAgentWaitReason(agent.id);

  const openLabel = agent.title.trim()
    ? t("mobile.agent.list.openPinnedWithTitle", { name: agent.name, title: agent.title.trim() })
    : t("mobile.agent.list.openPinned", { name: agent.name });
  const trigger = (
    <ChatLinkPressable
      chatId={agent.id}
      accessibilityLabel={
        waitReason
          ? t("mobile.agent.list.withState", { label: openLabel, state: t(AGENT_WAIT_STATE[waitReason]) })
          : openLabel
      }
      accessibilityRole="button"
      className="w-full items-center gap-2 px-1"
      onPressIn={agentChatPreview.onPressIn}
      delayLongPress={longPressDelay}
      onLongPress={() => {
        void haptics.longPress();
        if (isAndroid) setMenuKey((key) => key + 1);
      }}
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
            rings
          />
          {isUnread ? (
            <View
              className="absolute right-0 top-0 size-3.5 rounded-full border-2 bg-accent"
              style={{ borderColor: background, backgroundColor: accent }}
            />
          ) : null}
          {waitReason ? <AgentWaitBadge reason={waitReason} size={22} /> : null}
        </AgentPinAvatar>
      </ChatZoomSource>
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
    </PinnedChatItem>
  );
});

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
