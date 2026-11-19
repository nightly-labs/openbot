import { CHAT_BACKDROP_BASE, isChatBackdropScene } from "@openbot/brand/chat-backdrop-scenes";
import { Image } from "expo-image";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useId, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { HtmlPage } from "@/features/chat/components/html-page";
import {
  agentBackdropFile,
  backdropPhotoFile,
  type ChatBackdropChoice,
  useChatBackdrop,
} from "@/features/settings/model/chat-backdrop";
import { useReducedMotion } from "@/shared/lib/motion";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { ChatBackdropSceneView } from "./chat-backdrop-scene";

/** The part of the scene that the base color covers at the calmest strength. */
const MAX_COVER = 0.9;

/**
 * The color under the backdrop: the base of a scene, or the theme background under a page or a
 * photo. Null while no backdrop shows. The chat uses it where it used the chat background color, so
 * the composer and the notes match the scene.
 */
export function useChatBackdropBase(): string | null {
  const dark = useUniwind().theme === "dark";
  const choice = useShownBackdrop();
  const background = String(useThemeColor("background"));
  if (choice === "none") return null;
  if (isChatBackdropScene(choice)) return CHAT_BACKDROP_BASE[choice][dark ? "dark" : "light"];
  return background;
}

/** The choice that can show now: an agent page needs the web view, which an old Android build has not. */
function useShownBackdrop(): ChatBackdropChoice {
  const choice = useChatBackdrop((state) => (state.ready ? state.choice : "none"));
  return choice === "agent" && !HtmlPage ? "none" : choice;
}

/** The HTML of the agent page. A new page in the same file has a new version. */
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

/**
 * The backdrop of Settings › Appearance › Backdrop, under the chat, the top of Home and the preview of
 * Settings. It is the Ambient look: the base color covers the scene by the strength that the user
 * picked, most where the messages are in a chat, and half as much at the top of Home.
 *
 * `active` is false while the screen does not show; the scene then stops, as it does in the
 * background and with reduced motion.
 */
export function ChatBackdropLayer({ variant, active }: { variant: "chat" | "header" | "preview"; active: boolean }) {
  const dark = useUniwind().theme === "dark";
  const choice = useShownBackdrop();
  const base = useChatBackdropBase();
  const strength = useChatBackdrop((state) => state.strength);
  const photo = useChatBackdrop((state) => state.photo);
  const agentName = useChatBackdrop((state) => state.agentPage?.name ?? "");
  const foreground = useAppForeground();
  const reducedMotion = useReducedMotion();
  const page = useAgentPage(choice === "agent");
  const id = useId();
  if (choice === "none" || base === null) return null;
  const animate = active && foreground && !reducedMotion;
  const cover = (1 - strength) * MAX_COVER;
  // The top of Home is the brightest part of the backdrop, so it takes half the cover.
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
      {/* The page runs its scripts only on a screen that shows: a hidden screen unmounts its web view. */}
      {choice === "agent" && page !== null && HtmlPage && active ? (
        <HtmlPage source={page} title={agentName} mode="chat" />
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
            {/* A chat is calmest in the middle, where the messages are read. */}
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

/**
 * The backdrop of Home, behind the list: from the top of the screen to the top of the card
 * (`home-backdrop-card.tsx`), where `height` ends. It does not scroll: it is a fixed layer under the
 * list, so the scroll moves nothing in it. The card covers it as it rises.
 */
export function HomeBackdropBand({ height, active }: { height: number; active: boolean }) {
  const choice = useShownBackdrop();
  if (choice === "none" || height <= 0) return null;
  return (
    <View
      pointerEvents="none"
      // It ends at the bottom of the card top: under it the clear list shows the card color, also below
      // a short list and in an empty state, not the scene.
      style={{ position: "absolute", left: 0, right: 0, top: 0, height }}
    >
      <ChatBackdropLayer variant="header" active={active} />
    </View>
  );
}
