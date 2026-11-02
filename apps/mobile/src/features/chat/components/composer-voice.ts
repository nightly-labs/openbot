import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { SharedValue } from "react-native-reanimated";
import type { LiveConversationPhase } from "../model/live-conversation";
import type { LiveConversation } from "./use-live-conversation";
import type { VoiceMode } from "./use-voice-mode";

/** What the round voice button draws: a spinner, bars that follow the voice, or a microphone. */
type VoiceGlyph = "spinner" | "level" | "mic" | "micOff";

/**
 * The voice mode as the composer draws it. For dictation the mic of the composer turns into one round
 * button, and two buttons come out of its sides while `split` is open. A live conversation sets `bar`:
 * the composer turns into a call bar instead, and the chat above it stays in view.
 */
export interface ComposerVoice {
  available: boolean;
  open: boolean;
  exit: "send" | "cancel" | null;
  /** The microphone listens: the round button takes the agent's colour. */
  hearing: boolean;
  level: SharedValue<number>;
  presence: SharedValue<number>;
  /** Dictation only: 0 with one round button, 1 with its two side buttons out. */
  split?: SharedValue<number>;
  /** The mic of the composer opens the voice mode. */
  start: () => void;
  /** The name of the mic of the composer. */
  startLabel: string;
  center: { label: string; glyph: VoiceGlyph; pressable: boolean; busy: boolean; onPress: () => void };
  /** Dictation only: the side buttons take presses. */
  sides?: boolean;
  leading: { label: string; onPress: () => void };
  trailing: { label: string; icon: "send" | "interrupt"; enabled: boolean; onPress: () => void };
  /** The call bar of a live conversation: who speaks or what it does, and the words heard or read. */
  bar?: { title: string; caption: string };
}

const LIVE_PHASES = {
  starting: "mobile.chat.liveVoice.phase.starting",
  listening: "mobile.chat.liveVoice.phase.listening",
  sending: "mobile.chat.liveVoice.phase.thinking",
  thinking: "mobile.chat.liveVoice.phase.thinking",
  speaking: "mobile.chat.liveVoice.phase.speaking",
  offline: "mobile.chat.liveVoice.phase.offline",
} as const satisfies Record<LiveConversationPhase, MobileTextKey>;

/** Dictation with review: Stop, then Cancel, Continue and Send. Nothing is sent before Send. */
export function dictationVoice(voice: VoiceMode, t: MobileTranslate): ComposerVoice {
  const listening = voice.stage === "listening";
  return {
    available: voice.available,
    open: voice.stage !== "closed",
    exit: voice.exit,
    hearing: listening && !voice.exit,
    level: voice.level,
    presence: voice.presence,
    split: voice.split,
    start: voice.open,
    startLabel: t("mobile.chat.composer.dictate"),
    // Stop is pressable while the recognizer starts too, and then closes the voice mode. Continue
    // waits until the chat can listen again.
    center: listening
      ? {
          label: t("mobile.chat.composer.stopDictation"),
          glyph: voice.phase === "starting" ? "spinner" : "level",
          pressable: !voice.exit,
          busy: voice.phase === "starting",
          onPress: voice.stop,
        }
      : {
          label: t("mobile.chat.voice.continue"),
          glyph: "mic",
          pressable: !voice.exit && voice.canResume,
          busy: false,
          onPress: voice.resume,
        },
    sides: voice.stage === "review" && !voice.exit,
    leading: { label: t("mobile.chat.composer.cancelDictation"), onPress: voice.cancel },
    trailing: { label: t("mobile.chat.composer.send"), icon: "send", enabled: voice.canSend, onPress: voice.send },
  };
}

/**
 * A live conversation, as the voice pane on desktop, drawn as the call bar: Mute mutes and unmutes the
 * microphone, End closes the conversation, and Interrupt stops the agent's reply or the wait for it.
 */
export function liveVoice(live: LiveConversation, name: string, t: MobileTranslate): ComposerVoice {
  const hearing = live.phase === "listening" && !live.muted && !live.exit;
  const replying = live.phase === "thinking" || live.phase === "speaking";
  return {
    available: live.available,
    open: live.open,
    exit: live.exit,
    hearing,
    level: live.level,
    presence: live.presence,
    start: live.start,
    startLabel: t("mobile.chat.liveVoice.start"),
    center: {
      label: t(live.muted ? "mobile.chat.liveVoice.unmute" : "mobile.chat.liveVoice.mute"),
      glyph: live.muted
        ? "micOff"
        : live.phase === "starting" || live.phase === "sending" || live.phase === "thinking"
          ? "spinner"
          : live.phase === "offline"
            ? "mic"
            : "level",
      pressable: !live.exit && live.phase !== "offline",
      busy: live.phase === "starting" || live.phase === "sending" || live.phase === "thinking",
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
          live.muted && live.phase === "listening" ? "mobile.chat.liveVoice.phase.muted" : LIVE_PHASES[live.phase],
        ),
      }),
      // An error says why the conversation waits; otherwise the words heard, or the part read.
      caption: live.error ?? (live.caption || (hearing ? t("mobile.chat.liveVoice.speakNow") : "")),
    },
  };
}
