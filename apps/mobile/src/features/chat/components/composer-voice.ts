import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { SharedValue } from "react-native-reanimated";
import type { LiveConversationPhase } from "../model/live-conversation";
import type { LiveConversation } from "./use-live-conversation";

type VoiceGlyph = "spinner" | "level" | "mic" | "micOff";

export interface ComposerVoice {
  available: boolean;
  open: boolean;
  exit: "send" | "cancel" | null;
  level: SharedValue<number>;
  presence: SharedValue<number>;
  start: () => void;
  startLabel: string;
  center: { label: string; glyph: VoiceGlyph; pressable: boolean; busy: boolean; onPress: () => void };
  leading: { label: string; onPress: () => void };
  trailing: { label: string; icon: "send" | "interrupt"; enabled: boolean; onPress: () => void };
  bar: { title: string; caption: string };
}

const LIVE_PHASES = {
  starting: "mobile.chat.liveVoice.phase.starting",
  listening: "mobile.chat.liveVoice.phase.listening",
  sending: "mobile.chat.liveVoice.phase.thinking",
  thinking: "mobile.chat.liveVoice.phase.thinking",
  speaking: "mobile.chat.liveVoice.phase.speaking",
  offline: "mobile.chat.liveVoice.phase.offline",
} as const satisfies Record<LiveConversationPhase, MobileTextKey>;

export type LiveVoiceSource = Pick<
  LiveConversation,
  | "available"
  | "open"
  | "exit"
  | "phase"
  | "muted"
  | "micOpen"
  | "level"
  | "presence"
  | "start"
  | "toggleMute"
  | "interrupt"
  | "end"
  | "error"
  | "caption"
>;

export function liveVoice(live: LiveVoiceSource, name: string, t: MobileTranslate): ComposerVoice {
  const opening = live.phase === "listening" && !live.muted && !live.micOpen;
  const hearing = live.phase === "listening" && !live.muted && !live.exit && live.micOpen;
  const replying = live.phase === "thinking" || live.phase === "speaking";
  return {
    available: live.available,
    open: live.open,
    exit: live.exit,
    level: live.level,
    presence: live.presence,
    start: live.start,
    startLabel: t("mobile.chat.liveVoice.start"),
    center: {
      label: t(live.muted ? "mobile.chat.liveVoice.unmute" : "mobile.chat.liveVoice.mute"),
      glyph: live.muted
        ? "micOff"
        : opening || live.phase === "starting" || live.phase === "sending" || live.phase === "thinking"
          ? "spinner"
          : live.phase === "offline"
            ? "mic"
            : "level",
      pressable: !live.exit && live.phase !== "offline",
      busy: opening || live.phase === "starting" || live.phase === "sending" || live.phase === "thinking",
      onPress: live.toggleMute,
    },
    leading: { label: t("mobile.chat.liveVoice.end"), onPress: live.end },
    trailing: {
      label: t("mobile.chat.liveVoice.interrupt"),
      icon: "interrupt",
      enabled: replying,
      onPress: live.interrupt,
    },
    bar: {
      title: t("mobile.chat.liveVoice.status", {
        name,
        phase: t(
          live.muted && live.phase === "listening"
            ? "mobile.chat.liveVoice.phase.muted"
            : opening
              ? LIVE_PHASES.starting
              : LIVE_PHASES[live.phase],
        ),
      }),
      caption: live.error ?? (live.caption || (hearing ? t("mobile.chat.liveVoice.speakNow") : "")),
    },
  };
}
