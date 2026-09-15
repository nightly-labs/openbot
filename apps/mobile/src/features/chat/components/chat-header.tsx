import { GlassView } from "expo-glass-effect";
import { Link, router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowLeft, TriangleAlert } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { BlurReveal } from "@/shared/components/blur-reveal";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import type { ChatTarget } from "../model/chat-target";

interface ChatHeaderProps {
  target: ChatTarget;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  liquidGlassAvailable: boolean;
  topInset: number;
  onBack: () => void;
  needsAction?: boolean;
  readOnly?: boolean;
}

export function ChatHeader({
  target,
  fallbackBackground,
  foreground,
  liquidGlassAvailable,
  topInset,
  onBack,
  needsAction = false,
  readOnly = false,
}: ChatHeaderProps) {
  const warning = useThemeColor("warning");
  const { servers } = useMobileWorkspace();
  const disconnected = !servers.some((server) => server.id === target.serverId && server.state === "online");
  const members = useMemo(
    () => new Map(target.kind === "channel" ? target.members.map((member) => [member.id, member]) : []),
    [target],
  );
  const iconColor = String(foreground);

  return (
    <>
      <View
        className="absolute inset-x-0 z-20 flex-row items-center gap-2 px-4"
        pointerEvents="box-none"
        style={{ top: topInset + 8 }}
      >
        <ChatGlassIconButton
          accessibilityLabel="Back"
          fallbackBackground={fallbackBackground}
          liquidGlassAvailable={liquidGlassAvailable}
          onPress={onBack}
        >
          <ArrowLeft color={iconColor} size={24} strokeWidth={2} />
        </ChatGlassIconButton>

        <GlassView
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          style={{
            alignItems: "center",
            alignSelf: "stretch",
            backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
            borderCurve: "continuous",
            borderRadius: 24,
            flexDirection: "row",
            maxWidth: 220,
            flexShrink: 1,
            overflow: "hidden",
          }}
        >
          <Pressable
            className="min-w-0 shrink flex-row items-center gap-2 self-stretch px-3"
            accessibilityRole="button"
            accessibilityLabel={readOnly ? target.name : `Info for ${target.name}`}
            disabled={readOnly}
            hitSlop={8}
            onPress={() =>
              target.kind === "channel"
                ? router.push({
                    pathname: "/channel-info/[channelId]",
                    params: { channelId: target.id, serverId: target.serverId },
                  })
                : router.push({
                    pathname: "/agent-info/[agentId]",
                    params: { agentId: target.id, serverId: target.serverId },
                  })
            }
          >
            {target.kind === "channel" ? (
              <Link.AppleZoomTarget>
                <View collapsable={false}>
                  <ChannelAvatar
                    channel={{ members: target.members.map((member) => ({ agentId: member.id })) }}
                    agents={members}
                    size={28}
                    disconnected={disconnected}
                  />
                </View>
              </Link.AppleZoomTarget>
            ) : (
              <Link.AppleZoomTarget>
                <AgentPinAvatar agentId={target.id} location="chat" size={28}>
                  <BloubAvatar agentId={target.id} hue={target.avatarHue} seed={target.avatarSeed} size={28} />
                </AgentPinAvatar>
              </Link.AppleZoomTarget>
            )}
            <Typography.Paragraph className="min-w-0 shrink" weight="semibold" numberOfLines={1}>
              {target.name}
            </Typography.Paragraph>
          </Pressable>
        </GlassView>

        <View className="flex-1" />
        {target.kind === "channel" ? (
          <View style={{ width: 48, height: 48 }} collapsable={false} pointerEvents={needsAction ? "auto" : "none"}>
            <BlurReveal
              value={needsAction ? target : null}
              interactive
              collapseOnHide
              enterDuration={320}
              exitDuration={240}
            >
              {(actionTarget) => (
                <ChatGlassIconButton
                  accessibilityLabel="Actions needed"
                  fallbackBackground={fallbackBackground}
                  liquidGlassAvailable={liquidGlassAvailable}
                  onPress={() =>
                    router.push({
                      pathname: "/channel-actions/[channelId]",
                      params: { channelId: actionTarget.id, serverId: actionTarget.serverId },
                    })
                  }
                >
                  <TriangleAlert color={String(warning)} size={24} strokeWidth={2.5} />
                </ChatGlassIconButton>
              )}
            </BlurReveal>
          </View>
        ) : null}
      </View>
      <SheetScrollEdgeEffect
        style={{ height: topInset + 82, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
      />
    </>
  );
}
