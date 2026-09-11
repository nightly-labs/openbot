import { type MenuComponentRef, MenuView } from "@expo/ui/community/menu";
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { Link, router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { type PropsWithChildren, useEffect, useId, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
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
import { useUniwind } from "uniwind";
import { useAgentContextMenu } from "@/features/agents/components/agent-context-menu";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { AgentPinSwipeRow } from "@/features/agents/components/agent-pin-swipe-row";
import { type AgentAvatarLocation, useAgentPinTransition } from "@/features/agents/components/agent-pin-transition";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

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
  avatarLocation?: AgentAvatarLocation;
  agent: MobileAgent;
  dismissToChat?: boolean;
  enableActions?: boolean;
  enableZoomTransition?: boolean;
  leftInset?: number;
  rightInset?: number;
}

export function AgentListRow({
  avatarLocation = "row",
  agent,
  dismissToChat = false,
  enableActions = true,
  enableZoomTransition = true,
  leftInset = 20,
  rightInset = 20,
}: AgentListRowProps) {
  const { theme } = useUniwind();
  const [background] = useThemeColor(["background"]);
  const { unreadAgentIds } = useMobileWorkspace();
  const { startAgentNavigationAnimated, toggleAgentPinAnimated, transition } = useAgentPinTransition();
  const editMenu = useRef<MenuComponentRef>(null);
  const agentContextMenu = useAgentContextMenu(agent);
  const isUnread = unreadAgentIds.includes(agent.id);
  const isUnpinTarget = transition?.agentId === agent.id && transition.target === "row";
  const avatar = (
    <AgentPinAvatar agentId={agent.id} location={avatarLocation} size={54}>
      <BloubAvatar agentId={agent.id} hue={agent.avatarHue} seed={agent.avatarSeed} size={54} animateIdle={false} />
    </AgentPinAvatar>
  );

  const handleOpen = () => {
    if (dismissToChat) startAgentNavigationAnimated(agent.id, avatarLocation);
  };

  const linkTrigger = (
    <Link.Trigger>
      <ChatLinkPressable
        accessibilityLabel={`Open chat with ${agent.name}`}
        accessibilityRole="button"
        accessibilityActions={enableActions ? [{ name: "pin", label: `Pin ${agent.name}` }] : undefined}
        onAccessibilityAction={
          enableActions
            ? (event) => {
                if (event.nativeEvent.actionName === "pin") toggleAgentPinAnimated(agent.id);
              }
            : undefined
        }
        className="w-full"
        onLongPress={enableActions && Platform.OS === "android" ? () => editMenu.current?.show() : undefined}
      >
        {({ pressed }) => (
          <View
            className="min-h-20 w-full flex-row items-center gap-3 py-3"
            style={{
              backgroundColor: background,
              opacity: pressed ? 0.58 : 1,
              paddingLeft: leftInset,
              paddingRight: rightInset,
            }}
          >
            {enableZoomTransition ? <Link.AppleZoom>{avatar}</Link.AppleZoom> : avatar}
            <AgentRowTextReveal active={isUnpinTarget}>
              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row items-center gap-2">
                  {isUnread ? <View className="size-2 rounded-full bg-accent" /> : null}
                  <Typography.Paragraph className="min-w-0 flex-1" weight="semibold" numberOfLines={1}>
                    {agent.name}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-xs" className="text-muted">
                    {agent.updatedLabel}
                  </Typography.Paragraph>
                </View>
                <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
                  {agent.preview}
                </Typography.Paragraph>
              </View>
            </AgentRowTextReveal>
          </View>
        )}
      </ChatLinkPressable>
    </Link.Trigger>
  );

  const href = {
    pathname: "/chat/[agentId]" as const,
    params: dismissToChat ? { avatarTransition: "search", agentId: agent.id } : { agentId: agent.id },
  };
  const agentLink = enableActions ? (
    <Link href={href} asChild dismissTo={dismissToChat} onPress={handleOpen}>
      {linkTrigger}
      {agentContextMenu}
    </Link>
  ) : (
    <Link href={href} asChild dismissTo={dismissToChat} onPress={handleOpen}>
      {linkTrigger}
    </Link>
  );

  if (!enableActions) return agentLink;

  return (
    <AgentPinSwipeRow
      agentName={agent.name}
      onPin={(withHaptic) => toggleAgentPinAnimated(agent.id, { haptic: withHaptic })}
    >
      {Platform.OS === "android" ? (
        <MenuView
          ref={editMenu}
          colorScheme={theme === "dark" ? "dark" : "light"}
          shouldOpenOnLongPress
          actions={[{ id: "edit", title: "Info" }]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "edit")
              router.push({
                pathname: "/agent-info/[agentId]",
                params: { agentId: agent.id, serverId: agent.serverId },
              });
          }}
        >
          {agentLink}
        </MenuView>
      ) : (
        agentLink
      )}
    </AgentPinSwipeRow>
  );
}
