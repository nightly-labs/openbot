import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { memo, type PropsWithChildren, useEffect, useId, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useAgentChatPreview } from "@/features/agents/components/agent-chat-preview";
import { AgentAndroidMenu, AgentContextMenuLink } from "@/features/agents/components/agent-context-menu";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AgentPinSwipeRow } from "@/features/agents/components/agent-pin-swipe-row";
import { useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { AGENT_WAIT_STATE, AgentWaitBadge, AgentWaitChip } from "@/features/agents/components/agent-wait-badge";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { useChatRowBackground } from "@/features/agents/components/chat-list-pane-context";
import { ChatZoomSource } from "@/features/agents/components/chat-zoom-source";
import { useWaitingChannel } from "@/features/channels/components/use-waiting-channel";
import { useAgentWaitReason } from "@/features/workspace/components/use-agent-activity";
import { useAgentUnread } from "@/features/workspace/components/use-live-workspace";
import { type MobileAgent, useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

function AgentRowTextReveal({ active, children }: PropsWithChildren<{ active: boolean }>) {
  const gradientId = `agent-row-reveal-${useId().replaceAll(":", "")}`;
  const width = useSharedValue(0);
  const progress = useSharedValue(active ? 0 : 1);

  useEffect(() => {
    progress.set(
      active ? withDelay(45, withTiming(1, { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.System })) : 1,
    );
  }, [active, progress]);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.35, 1], [0, 0.78, 1]),
  }));
  const blurStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.35, 0.8, 1], [0.72, 0.58, 0.1, 0]),
  }));
  const maskProps = useAnimatedProps(() => ({ width: width.get() * progress.get() }));

  if (!active) return children;

  return (
    <Animated.View
      className="min-w-0 flex-1"
      onLayout={(event) => width.set(event.nativeEvent.layout.width)}
      style={contentStyle}
    >
      <MaskedView
        style={{ width: "100%" }}
        maskElement={
          <Svg height="100%" width="100%">
            <Defs>
              <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
                <Stop offset="0" stopColor="#000" stopOpacity="1" />
                <Stop offset="0.82" stopColor="#000" stopOpacity="1" />
                <Stop offset="1" stopColor="#000" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <AnimatedRect animatedProps={maskProps} fill={`url(#${gradientId})`} height="100%" x="0" y="0" />
          </Svg>
        }
      >
        {children}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}>
          <BlurView intensity={16} style={StyleSheet.absoluteFill} tint="systemUltraThinMaterial" />
        </Animated.View>
      </MaskedView>
    </Animated.View>
  );
}

interface AgentListRowProps {
  agent: MobileAgent;
  leftInset?: number;
  rightInset?: number;
}

/**
 * A chat of the home list. It renders again only when its agent, its own live state or a pin
 * transition changes, so a long list stays quiet while other agents work.
 */
export const AgentListRow = memo(function AgentListRow({ agent, leftInset = 20, rightInset = 20 }: AgentListRowProps) {
  const { t } = useText();
  const background = useChatRowBackground(agent.id);
  const pinBlocked = useMobileWorkspaceSelector(
    ({ pinnedAgentIds, pinnedChannelIds }) => !canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], agent.id),
  );
  const { toggleAgentPinAnimated, transition } = useAgentPinTransition();
  // Each long press mounts the Android menu again, so it opens even if an earlier one did not close.
  const [menuKey, setMenuKey] = useState(0);
  const agentChatPreview = useAgentChatPreview(agent);
  // An agent that waits in a channel says so, as its last message in its own chat is not the wait.
  const waitingChannel = useWaitingChannel(agent.id, agent.serverId);
  const lastMessage = useMemo(() => markdownPreviewText(agent.preview), [agent.preview]);
  const previewLine = waitingChannel
    ? t("mobile.chat.channelWork.waiting", { channel: waitingChannel.name })
    : lastMessage;
  const isUnread = useAgentUnread(agent.id);
  const waitReason = useAgentWaitReason(agent.id);
  const isUnpinTarget = transition?.chatId === agent.id && transition.target === "row";
  const bloub = (
    <BloubAvatar
      agentId={agent.id}
      serverId={agent.serverId}
      hue={agent.avatarHue}
      seed={agent.avatarSeed}
      size={54}
      animateIdle={false}
      rings
    />
  );
  const waitBadge = waitReason ? <AgentWaitBadge reason={waitReason} /> : null;
  const avatar = (
    <ChatZoomSource>
      <AgentPinAvatar agentId={agent.id} location="row" size={54}>
        {bloub}
        {waitBadge}
      </AgentPinAvatar>
    </ChatZoomSource>
  );
  const openLabel = agent.title.trim()
    ? t("mobile.agent.list.openWithTitle", { name: agent.name, title: agent.title.trim() })
    : t("mobile.agent.list.open", { name: agent.name });

  const row = (
    <ChatLinkPressable
      chatId={agent.id}
      accessibilityLabel={
        waitReason
          ? t("mobile.agent.list.withState", { label: openLabel, state: t(AGENT_WAIT_STATE[waitReason]) })
          : openLabel
      }
      accessibilityRole="button"
      accessibilityActions={[{ name: "pin", label: t("mobile.agent.pin.pinNamed", { name: agent.name }) }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "pin") toggleAgentPinAnimated(agent.id);
      }}
      className="w-full"
      onPressIn={agentChatPreview.onPressIn}
      delayLongPress={longPressDelay}
      onLongPress={() => {
        void haptics.longPress();
        if (isAndroid) setMenuKey((key) => key + 1);
      }}
    >
      {({ pressed }) => (
        <View
          className="min-h-20 w-full flex-row items-center gap-3 py-1"
          style={{
            backgroundColor: background,
            opacity: pressed ? 0.58 : 1,
            paddingLeft: leftInset,
            paddingRight: rightInset,
          }}
        >
          {avatar}
          <AgentRowTextReveal active={isUnpinTarget}>
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row items-center gap-2">
                {isUnread ? <View className="size-2 rounded-full bg-accent" /> : null}
                <Typography.Paragraph
                  className="font-semibold min-w-0 flex-1"
                  numberOfLines={1}
                  style={typeScale.rowTitle}
                >
                  {agent.name}
                </Typography.Paragraph>
                {waitReason ? (
                  <AgentWaitChip reason={waitReason} />
                ) : (
                  <Typography.Paragraph className="text-muted" style={typeScale.caption}>
                    {agent.updatedLabel}
                  </Typography.Paragraph>
                )}
              </View>
              {agent.title.trim() ? (
                <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
                  {agent.title.trim()}
                </Typography.Paragraph>
              ) : null}
              <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.preview}>
                {previewLine}
              </Typography.Paragraph>
            </View>
          </AgentRowTextReveal>
          {agentChatPreview.measurer}
        </View>
      )}
    </ChatLinkPressable>
  );
  return (
    <AgentPinSwipeRow
      agentName={agent.name}
      pinBlocked={pinBlocked}
      onPin={(withHaptic) => toggleAgentPinAnimated(agent.id, { haptic: withHaptic })}
    >
      {isAndroid ? (
        <View>
          <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id } }} asChild>
            <Link.Trigger>{row}</Link.Trigger>
          </Link>
          {menuKey > 0 ? <AgentAndroidMenu key={menuKey} agent={agent} onClose={() => setMenuKey(0)} /> : null}
        </View>
      ) : (
        <AgentContextMenuLink agent={agent} preview={agentChatPreview.preview}>
          {row}
        </AgentContextMenuLink>
      )}
    </AgentPinSwipeRow>
  );
});
