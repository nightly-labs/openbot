import { CHAT_BACKDROP_BASE, isChatBackdropScene } from "@openbot/brand/chat-backdrop-scenes";
import { Image } from "expo-image";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useId, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { HtmlPage } from "@/features/chat/components/html-page";
import { useRemoteChatContent } from "@/features/servers/model/use-remote-chat-content";
import {
  agentBackdropFile,
  backdropPhotoFile,
  type ChatBackdropChoice,
  useChatBackdrop,
} from "@/features/settings/model/chat-backdrop";
import { useReducedMotion } from "@/shared/lib/motion";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { ChatBackdropSceneView } from "./chat-backdrop-scene";

const MAX_COVER = 0.9;

export function useChatBackdropBase(): string | null {
  const dark = useUniwind().theme === "dark";
  const choice = useShownBackdrop();
  const background = String(useThemeColor("background"));
  if (choice === "none") return null;
  if (isChatBackdropScene(choice)) return CHAT_BACKDROP_BASE[choice][dark ? "dark" : "light"];
  return background;
}

function useShownBackdrop(): ChatBackdropChoice {
  const choice = useChatBackdrop((state) => (state.ready ? state.choice : "none"));
  return choice === "agent" && !HtmlPage ? "none" : choice;
}

function useAgentPage(enabled: boolean): string | null {
  const version = useChatBackdrop((state) => state.pageVersion);
  const [page, setPage] = useState<{ version: number; html: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    agentBackdropFile()
      .text()
      .then((html) => {
        if (active) setPage({ version, html });
      })
      .catch(() => {
        if (active) setPage(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, version]);
  return enabled ? (page?.html ?? null) : null;
}

export function ChatBackdropLayer({ variant, active }: { variant: "chat" | "header" | "preview"; active: boolean }) {
  const dark = useUniwind().theme === "dark";
  const choice = useShownBackdrop();
  const base = useChatBackdropBase();
  const strength = useChatBackdrop((state) => state.strength);
  const photo = useChatBackdrop((state) => state.photo);
  const agentName = useChatBackdrop((state) => state.agentPage?.name ?? "");
  const pageScripts = useRemoteChatContent(useChatBackdrop((state) => state.agentPage?.serverId));
  const foreground = useAppForeground();
  const reducedMotion = useReducedMotion();
  const page = useAgentPage(choice === "agent");
  const id = useId();
  if (choice === "none" || base === null) return null;
  const animate = active && foreground && !reducedMotion;
  const cover = (1 - strength) * MAX_COVER;
  const scrim = variant === "header" ? cover * 0.5 : cover;
  const scrimId = `${id}-scrim`;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: base }]}
    >
      {isChatBackdropScene(choice) ? <ChatBackdropSceneView scene={choice} dark={dark} animate={animate} /> : null}
      {choice === "agent" && page !== null && HtmlPage && active ? (
        <HtmlPage source={page} title={agentName} mode="chat" scripts={pageScripts} />
      ) : null}
      {choice === "photo" && photo ? (
        <Image
          source={{ uri: backdropPhotoFile(photo).uri }}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
          accessible={false}
        />
      ) : null}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={scrimId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={base} stopOpacity={scrim * 0.35} />
            <Stop offset="0.35" stopColor={base} stopOpacity={scrim} />
            <Stop offset="0.8" stopColor={base} stopOpacity={scrim} />
            <Stop offset="1" stopColor={base} stopOpacity={scrim * 0.5} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${scrimId})`} />
      </Svg>
    </View>
  );
}

export function HomeBackdropBand({ height, active }: { height: number; active: boolean }) {
  const choice = useShownBackdrop();
  if (choice === "none" || height <= 0) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height }}>
      <ChatBackdropLayer variant="header" active={active} />
    </View>
  );
}
