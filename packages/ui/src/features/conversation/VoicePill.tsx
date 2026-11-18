import type { AppTextKey } from "@openbot/i18n";
import { Button, LabelTooltip, LabelTooltipTrigger, Mic, MicOff, X } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { StopIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import { VoiceWaveform } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import {
  createMotion,
  GooFilter,
  LIQUID_CLOSE,
  LIQUID_OPEN,
  LIQUID_PAD,
  SLIDE_END,
  SNAPPY,
  SOFT,
  stagedCurve,
} from "@openbot/ui/liquid";
import { useText } from "@openbot/ui/text";
import { clamp, mix } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createEffect, createUniqueId, onSettled, Show, untrack } from "solid-js";

/** What a voice conversation does now. */
export type VoicePhase = "starting" | "listening" | "thinking" | "speaking" | "offline";

const PHASE_LABELS: Record<VoicePhase, AppTextKey> = {
  starting: "conversation.voice.phase.starting",
  listening: "conversation.voice.phase.listening",
  thinking: "conversation.voice.phase.thinking",
  speaking: "conversation.voice.phase.speaking",
  offline: "conversation.voice.phase.offline",
};

/** The pill shows the newest readings only, so the waveform stays short. */
const PILL_LEVELS = 12;
/** The frame part of the liquid stops this far above the edge: the goo spreads it a little. */
const FRAME_GAP = 2;
/** The neck starts this far above the edge, in the frame. */
const ROOT = 8;

export interface VoicePillProps {
  agent: AgentProfile;
  phase: VoicePhase;
  /** The microphone is off until the user unmutes it. */
  muted: boolean;
  /** The latest loudness readings of the voice that is heard now, from 0 to 1, oldest first. */
  levels: readonly number[];
  /** Why the conversation stopped listening. */
  error: string | null;
  onToggleMute: () => void;
  /** Stops the reply, or the wait for it, and listens again. */
  onInterrupt: () => void;
  onEnd: () => void;
  /** The speed of the reply, where 1 is normal speed. */
  speed?: number | undefined;
  /** Changes to the next speed. Without it, the pill has no speed button. */
  onCycleSpeed?: (() => void) | undefined;
  /** Off: the pill flows back into the top edge, then calls `onClosed`. On by default. */
  open?: boolean | undefined;
  onClosed?: (() => void) | undefined;
}

/**
 * A conversation by voice, in a pill at the top of the chat. The agent listens until you stop
 * speaking, sends what you said to the chat, and reads its reply aloud; then it listens again. The
 * chat and the message box stay as they are, so the turns show in the chat as they are sent. The pill
 * comes out of the window frame at the top edge of the chat as a drop, gets wider, and comes off the
 * frame on a thin neck; it closes the same way back. It uses the goo and the springs of the agent
 * dock (`liquid.tsx`).
 */
export function VoicePill(props: VoicePillProps) {
  const { t, format } = useText();
  const speed = () => format.number(props.speed ?? 1);
  const hearing = () => props.phase === "listening" && !props.muted;
  // While the conversation runs, the face changes as the sidebar avatar of a working agent does.
  const live = () =>
    !props.muted && (props.phase === "listening" || props.phase === "thinking" || props.phase === "speaking");
  const filterId = `voice-pill-goo-${createUniqueId()}`;
  let dock!: HTMLDivElement;
  let body!: HTMLDivElement;
  let neck!: HTMLDivElement;
  let shape!: HTMLDivElement;
  let face!: HTMLElement;
  let ready = false;
  /** The height of the pill: the height of its content. */
  let depth = 0;
  /** The distance from the top edge to the pill at rest, from the style of the content. */
  let gap = 0;

  const motion = createMotion(() => render());
  /** Open progress: 0 is in the frame, 1 is the pill at rest. */
  const open = motion.spring(0, LIQUID_OPEN);
  // 0 while the pill opens, 1 while it closes: a close goes back as a drop, not as a wide bar.
  const closing = motion.spring(0, SOFT);
  /** The length of the pill. It follows the content. */
  const length = motion.spring(0, SNAPPY);

  function measure() {
    depth = face.offsetHeight;
    gap = face.offsetTop;
    return face.offsetWidth;
  }

  function place(element: HTMLElement, left: number, top: number, width: number, height: number, radius: string) {
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.borderRadius = radius;
  }

  function render() {
    const progress = Math.max(0, open.value);
    const mode = clamp(closing.value, 0, 1);
    const center = dock.clientWidth / 2;
    // Until SLIDE_END the drop comes down out of the frame and swells along it; then it grows to the
    // full pill and comes off the frame. On close, the middle shape is a round drop, so the pill goes
    // back into the frame as a drop.
    const top = stagedCurve(progress, -depth, 0, gap);
    const middle = mix(Math.min(length.value, depth * 1.6), depth, mode);
    const width = Math.max(0, stagedCurve(progress, depth * 0.5, middle, length.value));
    const round = `${Math.min(width, depth) / 2}px`;
    const left = center - width / 2;
    place(body, left, LIQUID_PAD + top, width, depth, round);
    place(shape, left, top, width, depth, round);
    // The neck holds the pill to the frame while it moves away, then gets thin and goes back up; the
    // goo breaks it when it is thin.
    const away = clamp((progress - SLIDE_END) / (1 - SLIDE_END), 0, 1);
    const neckWidth = Math.min(width, depth) * 0.6 * (1 - away);
    const reach = Math.max(0, (top + depth / 2) * (1 - away));
    place(
      neck,
      center - neckWidth / 2,
      LIQUID_PAD - ROOT,
      neckWidth,
      ROOT + reach,
      `0 0 ${neckWidth / 2}px ${neckWidth / 2}px`,
    );
    // The liquid pill gives way to the sharp one when it is off the frame, so the goo does not pull
    // its top edge to the frame at rest.
    body.style.opacity = progress > 0.001 ? `${1 - clamp((away - 0.9) / 0.1, 0, 1)}` : "0";
    neck.style.opacity = progress > 0.001 ? "1" : "0";
    shape.style.opacity = `${clamp((away - 0.6) / 0.25, 0, 1)}`;
    // The blur behind the pill comes down with it and fades in with the open progress (voice.css).
    dock.style.setProperty("--voice-pill-open", `${clamp(progress, 0, 1)}`);
    dock.style.setProperty("--voice-pill-drop", `${top - gap}px`);
    // The content shows only when the pill is almost full, so no control sits outside the liquid.
    const reveal = clamp((progress - 0.86) / 0.14, 0, 1);
    face.style.opacity = `${reveal}`;
    face.style.transform = `translateY(${top - gap}px) scale(${0.96 + 0.04 * reveal})`;
  }

  createEffect(
    () => props.open ?? true,
    (shown) => {
      if (shown) {
        if (open.value < 0.02) closing.jump(0);
        else closing.to(0);
        open.to(1, undefined, LIQUID_OPEN);
      } else {
        if (open.value > 0.98) closing.jump(1);
        else closing.to(1);
        open.to(0, () => untrack(() => props.onClosed)?.(), LIQUID_CLOSE);
      }
      if (ready) motion.kick();
    },
  );

  onSettled(() => {
    length.jump(measure());
    ready = true;
    motion.kick();
    // New controls, such as the speed, change the length; the pill follows on its spring.
    const observer = new ResizeObserver(() => {
      length.to(measure());
      motion.kick();
    });
    observer.observe(face);
    // A new chat width moves the centre: the pill must be placed again.
    observer.observe(dock);
    return () => {
      observer.disconnect();
      motion.stop();
    };
  });

  return (
    <div class="voice-pill-dock" data-closing={props.open === false ? "" : undefined} ref={dock}>
      <div class="voice-pill-blur" aria-hidden="true">
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>
      <GooFilter id={filterId} class="voice-pill-filter" />
      {/* The liquid: the window frame above the edge, the neck and the pill, under the goo filter. */}
      <div
        class="voice-pill-liquid"
        aria-hidden="true"
        style={{
          top: `${-LIQUID_PAD}px`,
          // Room below the pill for the liquid that the filter spreads.
          height: `${LIQUID_PAD * 4}px`,
          filter: `url(#${filterId})`,
          // Only the part below the edge shows: the frame above it is the window frame itself.
          "clip-path": `inset(${LIQUID_PAD}px 0 0)`,
        }}
      >
        <div class="voice-pill-frame" style={{ height: `${LIQUID_PAD - FRAME_GAP}px` }} />
        <div class="voice-pill-neck" ref={neck} />
        <div class="voice-pill-body" ref={body} />
      </div>
      {/* The pill again, without the filter, so its shape stays exact at rest. */}
      <div class="voice-pill-shape" aria-hidden="true" ref={shape} />
      <section
        class="voice-pill"
        aria-label={t("conversation.voice.label", { name: props.agent.name })}
        data-phase={props.phase}
        data-muted={props.muted ? "" : undefined}
        inert={props.open === false ? true : undefined}
        ref={face}
      >
        <AgentAvatar
          agent={props.agent}
          mood={live() ? "working" : "waiting"}
          motion="idle"
          workingFaces
          class="voice-pill-avatar"
        />
        <span class="voice-pill-phase sr-only" aria-live="polite">
          {t(props.muted && props.phase === "listening" ? "conversation.voice.phase.muted" : PHASE_LABELS[props.phase])}
        </span>
        <VoiceWaveform
          levels={hearing() || props.phase === "speaking" ? props.levels.slice(-PILL_LEVELS) : []}
          class="voice-pill-waveform"
        />
        <Show when={props.onCycleSpeed}>
          {(cycleSpeed) => (
            <PillAction
              text={t("chat.voice.speed")}
              label={t("chat.voice.speedLabel", { speed: speed() })}
              class="voice-pill-speed"
              onClick={() => cycleSpeed()()}
            >
              {t("chat.voice.speedValue", { speed: speed() })}
            </PillAction>
          )}
        </Show>
        <PillAction text={t("conversation.voice.mute")} pressed={props.muted} onClick={() => props.onToggleMute()}>
          <Show when={props.muted} fallback={<Mic aria-hidden="true" />}>
            <MicOff aria-hidden="true" />
          </Show>
        </PillAction>
        <PillAction
          text={t("conversation.voice.interrupt")}
          disabled={props.phase !== "speaking" && props.phase !== "thinking"}
          onClick={() => props.onInterrupt()}
        >
          <StopIcon />
        </PillAction>
        <PillAction text={t("conversation.voice.end")} onClick={() => props.onEnd()}>
          <X aria-hidden="true" />
        </PillAction>
      </section>
      <Show when={props.error}>
        {(error) => (
          <p class="voice-pill-error" role="alert">
            {error()}
          </p>
        )}
      </Show>
    </div>
  );
}

/**
 * A round action of the pill, as the actions in the toolbar of a canvas node: secondary text until the pointer
 * or the focus is on it, and its name in a tooltip above it.
 */
function PillAction(props: {
  text: string;
  /** The accessible name when the text alone is not enough, such as the speed now. */
  label?: string;
  pressed?: boolean;
  disabled?: boolean;
  class?: string;
  onClick: () => void;
  children: JSX.Element;
}) {
  return (
    <LabelTooltip content={props.text} class="voice-pill-tooltip" disabled={props.disabled ?? false}>
      <LabelTooltipTrigger
        as={Button}
        variant="ghost"
        size="icon-sm"
        type="button"
        class={props.class ? `voice-pill-button ${props.class}` : "voice-pill-button"}
        aria-label={props.label ?? props.text}
        aria-pressed={props.pressed === undefined ? undefined : props.pressed ? "true" : "false"}
        disabled={props.disabled}
        onClick={() => props.onClick()}
      >
        {props.children}
      </LabelTooltipTrigger>
    </LabelTooltip>
  );
}
