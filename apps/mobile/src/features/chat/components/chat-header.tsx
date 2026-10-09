import { GlassView } from "expo-glass-effect";
import { Link, router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ArrowLeft, Globe, TriangleAlert } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useBrowserFeature } from "@/features/browser/components/use-browser-feature";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { BlurReveal } from "@/shared/components/blur-reveal";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
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
  /** Something covers the header, such as the voice mode, so screen readers skip it. */
  accessibilityHidden?: boolean;
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
  accessibilityHidden = false,
}: ChatHeaderProps) {
  const warning = useThemeColor("warning");
  const { t } = useText();
  const { servers, browserViewSupport } = useMobileWorkspace();
  const disconnected = !servers.some((server) => server.id === target.serverId && server.state === "online");
  const browserAllowed = useBrowserFeature();
  // The agent's browser on the host, live. The button shows when the agent has no tab yet too: the
  // browser screen opens a new one. A host that cannot stream a tab, or an app version the account
  // server has the browser off for, shows no button.
  const browserTarget =
    target.kind === "agent" && browserAllowed && !disconnected && !readOnly && browserViewSupport(target.serverId).view
      ? target
      : null;
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
        accessibilityElementsHidden={accessibilityHidden}
        importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
        style={{ top: topInset + 8 }}
      >
        <ChatGlassIconButton
          accessibilityLabel={t("common.back")}
          fallbackBackground={fallbackBackground}
          liquidGlassAvailable={liquidGlassAvailable}
          onPress={() => {
            void haptics.impact("soft");
            onBack();
          }}
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
            accessibilityLabel={readOnly ? target.name : t("mobile.chat.header.info", { name: target.name })}
            disabled={readOnly}
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
                  <BloubAvatar
                    agentId={target.id}
                    serverId={target.serverId}
                    hue={target.avatarHue}
                    seed={target.avatarSeed}
                    size={28}
                  />
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
                  accessibilityLabel={t("mobile.chat.header.actionsNeeded")}
                  fallbackBackground={fallbackBackground}
                  liquidGlassAvailable={liquidGlassAvailable}
                  onPress={() => {
                    void haptics.impact("soft");
                    router.push({
                      pathname: "/channel-actions/[channelId]",
                      params: { channelId: actionTarget.id, serverId: actionTarget.serverId },
                    });
                  }}
                >
                  <TriangleAlert color={String(warning)} size={24} strokeWidth={2.5} />
                </ChatGlassIconButton>
              )}
            </BlurReveal>
          </View>
        ) : (
          <View style={{ width: 48, height: 48 }} collapsable={false} pointerEvents={browserTarget ? "auto" : "none"}>
            <BlurReveal value={browserTarget} interactive collapseOnHide enterDuration={320} exitDuration={240}>
              {(agent) => (
                <ChatGlassIconButton
                  accessibilityLabel={t("mobile.browser.open")}
                  fallbackBackground={fallbackBackground}
                  liquidGlassAvailable={liquidGlassAvailable}
                  onPress={() => {
                    void haptics.impact("soft");
                    router.push({
                      pathname: "/browser/[agentId]",
                      params: { agentId: agent.id, serverId: agent.serverId },
                    });
                  }}
                >
                  <Globe color={iconColor} size={24} strokeWidth={2} />
                </ChatGlassIconButton>
              )}
            </BlurReveal>
          </View>
        )}
      </View>
      <SheetScrollEdgeEffect
        style={{ height: topInset + 82, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
      />
    </>
  );
}
