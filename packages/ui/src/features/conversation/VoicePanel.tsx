import type { AppTextKey } from "@openbot/i18n";
import { Button, Mic, MicOff, X } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { StopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { VoiceWaveform } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

/** What a voice conversation does now. */
export type VoicePanelPhase = "starting" | "listening" | "thinking" | "speaking" | "offline";

const PHASE_LABELS: Record<VoicePanelPhase, AppTextKey> = {
  starting: "conversation.voice.phase.starting",
  listening: "conversation.voice.phase.listening",
  thinking: "conversation.voice.phase.thinking",
  speaking: "conversation.voice.phase.speaking",
  offline: "conversation.voice.phase.offline",
};

const PHASE_MOODS = {
  starting: "waiting",
  listening: "waiting",
  thinking: "working",
  speaking: "responded",
  offline: "waiting",
} as const;

export interface VoicePanelProps {
  agent: AgentProfile;
  phase: VoicePanelPhase;
  /** The microphone is off until the user unmutes it. */
  muted: boolean;
  /** What the user said in this turn, so far. */
  heard: string;
  /** The part of the reply that plays now. */
  said: string;
  /** The latest loudness readings of the voice that is heard now, from 0 to 1, oldest first. */
  levels: readonly number[];
  /** Why the conversation stopped listening. */
  error: string | null;
  onToggleMute: () => void;
  /** Stops the reply, or the wait for it, and listens again. */
  onInterrupt: () => void;
  onEnd: () => void;
}

/**
 * A conversation by voice in the side panel. The agent listens until you stop speaking, sends what you
 * said to the chat, and reads its reply aloud; then it listens again. The agent's face grows with the
 * voice that is heard, a waveform under it moves with your voice or the agent's, and the captions show
 * what you say and what it says.
 */
export function VoicePanel(props: VoicePanelProps) {
  const { t } = useText();
  const hearing = () => props.phase === "listening" && !props.muted;
  const level = () => props.levels.at(-1) ?? 0;
  const scale = () => {
    if (props.phase === "speaking") return 1 + level() * 0.14;
    if (hearing()) return 1 + level() * 0.06;
    return 1;
  };
  return (
    <aside class="browser-panel voice-panel" aria-label={t("conversation.voice.label", { name: props.agent.name })}>
      <header class="voice-panel-header">
        <h2 class="voice-panel-name">{props.agent.name}</h2>
        <span class="voice-panel-phase">
          {t(props.muted && props.phase === "listening" ? "conversation.voice.phase.muted" : PHASE_LABELS[props.phase])}
        </span>
      </header>
      <div class="voice-panel-stage">
        <div
          class="voice-panel-presence"
          data-phase={props.phase}
          data-muted={props.muted ? "" : undefined}
          style={{ "--voice-presence-scale": String(scale()) }}
        >
          <AgentAvatar agent={props.agent} mood={PHASE_MOODS[props.phase]} motion="always" class="voice-panel-avatar" />
        </div>
        <div
          class="voice-panel-waveform"
          data-phase={hearing() || props.phase === "speaking" ? props.phase : undefined}
        >
          <VoiceWaveform levels={props.levels} />
        </div>
        <div class="voice-panel-captions">
          <Show
            when={props.error}
            fallback={
              <Show
                when={props.phase === "speaking"}
                fallback={
                  <p class="voice-panel-caption" data-empty={props.heard ? undefined : ""}>
                    {props.heard || (hearing() ? t("conversation.voice.speakNow") : "")}
                  </p>
                }
              >
                <p class="voice-panel-caption">{props.said}</p>
              </Show>
            }
          >
            {(error) => (
              <p class="voice-panel-caption voice-panel-error" role="alert">
                {error()}
              </p>
            )}
          </Show>
        </div>
      </div>
      <div class="voice-panel-controls">
        <Button
          variant={props.muted ? "default" : "secondary"}
          size="icon-lg"
          type="button"
          class="voice-panel-control"
          aria-label={t("conversation.voice.mute")}
          title={t("conversation.voice.mute")}
          aria-pressed={props.muted ? "true" : "false"}
          onClick={() => props.onToggleMute()}
        >
          <Show when={props.muted} fallback={<Mic aria-hidden="true" />}>
            <MicOff aria-hidden="true" />
          </Show>
        </Button>
        <Button
          variant="secondary"
          size="icon-lg"
          type="button"
          class="voice-panel-control"
          aria-label={t("conversation.voice.interrupt")}
          title={t("conversation.voice.interrupt")}
          disabled={props.phase !== "speaking" && props.phase !== "thinking"}
          onClick={() => props.onInterrupt()}
        >
          <StopIcon />
        </Button>
        <Button
          variant="destructive"
          size="icon-lg"
          type="button"
          class="voice-panel-control"
          aria-label={t("conversation.voice.end")}
          title={t("conversation.voice.end")}
          onClick={() => props.onEnd()}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
