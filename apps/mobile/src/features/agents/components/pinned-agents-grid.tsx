import { Link } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { View } from "react-native";
import Animated, {
  CurvedTransition,
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";
import { useAgentContextMenu } from "@/features/agents/components/agent-context-menu";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatLinkPressable } from "@/features/agents/components/chat-link-pressable";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
const PINNED_LAYOUT = LinearTransition.duration(220).easing(EASE_IN_OUT).reduceMotion(ReduceMotion.System);
const PINNED_ITEM_LAYOUT = CurvedTransition.duration(240)
  .easingX(EASE_IN_OUT)
  .easingY(EASE_IN_OUT)
  .reduceMotion(ReduceMotion.System);
const PINNED_ENTER = FadeIn.duration(180).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const PINNED_EXIT = FadeOut.duration(140).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

export function PinnedAgentsGrid({ agents }: { agents: MobileAgent[] }) {
  return (
    <Animated.View layout={PINNED_LAYOUT}>
      {agents.length > 0 ? (
        <Animated.View exiting={PINNED_EXIT} style={{ width: "100%" }}>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              rowGap: 18,
              paddingHorizontal: 12,
              paddingVertical: 22,
            }}
          >
            {agents.map((agent) => (
              <PinnedAgentItem key={agent.id} agent={agent} />
            ))}
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function PinnedAgentItem({ agent }: { agent: MobileAgent }) {
  const [background, accent] = useThemeColor(["background", "accent"]);
  const { unreadAgentIds } = useMobileWorkspace();
  const agentContextMenu = useAgentContextMenu(agent);
  const isUnread = unreadAgentIds.includes(agent.id);

  return (
    <Animated.View
      entering={PINNED_ENTER}
      exiting={PINNED_EXIT}
      layout={PINNED_ITEM_LAYOUT}
      style={{ width: "25%", alignItems: "center" }}
    >
      <Link href={{ pathname: "/chat/[agentId]", params: { agentId: agent.id } }} asChild>
        <Link.Trigger>
          <ChatLinkPressable
            accessibilityLabel={`Open pinned chat with ${agent.name}`}
            accessibilityRole="button"
            className="w-full items-center gap-2 px-1"
            style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}
          >
            <Link.AppleZoom>
              <AgentPinAvatar agentId={agent.id} location="pinned" size={64}>
                <BloubAvatar
                  agentId={agent.id}
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
            </Link.AppleZoom>
            <Typography.Paragraph
              type="body-xs"
              align="center"
              className="w-full text-text-secondary"
              numberOfLines={1}
            >
              {agent.name}
            </Typography.Paragraph>
          </ChatLinkPressable>
        </Link.Trigger>
        {agentContextMenu}
      </Link>
    </Animated.View>
  );
}
