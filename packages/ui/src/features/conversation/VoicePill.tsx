import type { AppTextKey } from "@openbot/i18n";
import { AudioLines, Button, Hand, LabelTooltip, LabelTooltipTrigger, Mic, MicOff, SlidingTabs, X } from "@openbot/ui";
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
import { createEffect, createUniqueId, For, onSettled, Show, untrack } from "solid-js";
import { TalkKeyCaps } from "./TalkKeyCaps";
import {
  completesTalkKey,
  isTalkKeyPart,
  type TalkKeyBinding,
  talkKeyAria,
  talkKeyPresses,
  talkKeyTypes,
} from "./talk-key";

/** What a voice conversation does now. */
export type VoicePhase = "starting" | "listening" | "thinking" | "speaking" | "offline";

/**
 * How the user talks: `push` opens the microphone only while they hold the talk button or the talk key, and
 * sends when they let go; `open` listens all the time and sends at a pause.
 */
export type VoiceTalkMode = "push" | "open";

const TALK_MODES = ["open", "push"] as const satisfies readonly VoiceTalkMode[];

const TALK_MODE_LABELS: Record<VoiceTalkMode, AppTextKey> = {
  open: "conversation.voice.talkMode.open",
  push: "conversation.voice.talkMode.push",
};

function isVoiceTalkMode(value: string): value is VoiceTalkMode {
  return TALK_MODES.some((mode) => mode === value);
}

/** A key that types talks only outside a text field. */
function typingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

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
  talkMode: VoiceTalkMode;
  onTalkModeChange: (mode: VoiceTalkMode) => void;
  /** Push to talk: the keys that the user holds to talk, from Settings. */
  talkKey: TalkKeyBinding;
  /** Push to talk: the user holds the talk button or the talk key now. */
  talking: boolean;
  /** Push to talk: the user presses the talk button or the talk key. */
  onTalkStart: () => void;
  /** Push to talk: the user lets go. What they said is sent. */
  onTalkEnd: () => void;
  /** Push to talk: the user pressed another key with the talk key, for a shortcut. Nothing is sent. */
  onTalkCancel: () => void;
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
 * A conversation by voice, in a pill at the top of the chat. With push to talk, the user holds the
 * talk button or the talk key while they speak, and what they said goes to the chat when they let go. With the
 * open microphone, the agent listens until you stop speaking. The agent reads its reply aloud; then it
 * listens again. The chat and the message box stay as they are, so the turns show in the chat as they
 * are sent. The pill comes out of the window frame at the top edge of the chat as a drop, gets wider,
 * and comes off the frame on a thin neck; it closes the same way back. It uses the goo and the springs
 * of the agent dock (`liquid.tsx`).
 */
export function VoicePill(props: VoicePillProps) {
  const { t, format } = useText();
  const speed = () => format.number(props.speed ?? 1);
  const push = () => props.talkMode === "push";
  const hearing = () => props.phase === "listening" && !props.muted;
  /** The user turned the open microphone off. Push to talk waits with it off, and is not muted. */
  const micOff = () => props.muted && !push();
  // While the conversation runs, the face changes as the sidebar avatar of a working agent does.
  const live = () =>
    !micOff() && (props.phase === "listening" || props.phase === "thinking" || props.phase === "speaking");
  const phaseLabel = (): AppTextKey => {
    if (props.phase !== "listening") return PHASE_LABELS[props.phase];
    if (push()) return props.talking ? PHASE_LABELS.listening : "conversation.voice.talkMode.push";
    return props.muted ? "conversation.voice.phase.muted" : PHASE_LABELS.listening;
  };
  const filterId = `voice-pill-goo-${createUniqueId()}`;
  let dock!: HTMLDivElement;
  let body!: HTMLDivElement;
  let neck!: HTMLDivElement;
  let shape!: HTMLDivElement;
  let face!: HTMLElement;
  let talkPad: HTMLButtonElement | undefined;
  let slot!: HTMLDivElement;
  let wave!: HTMLDivElement;
  let padFace!: HTMLSpanElement;
  let waveWidth = 0;
  let padWidth = 0;
  let shownTalk = Number.NaN;
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
  const talk = motion.spring(untrack(push) ? 1 : 0, SNAPPY);

  function measure() {
    depth = face.offsetHeight;
    gap = face.offsetTop;
    return face.offsetWidth;
  }

  function applyTalk() {
    shownTalk = talk.value;
    slot.style.width = `${Math.max(0, mix(waveWidth, padWidth, talk.value))}px`;
    face.style.setProperty("--voice-pill-push", `${talk.value}`);
  }

  function measureTalk() {
    waveWidth = wave.offsetWidth;
    padWidth = padFace.offsetWidth;
    applyTalk();
  }

  function place(element: HTMLElement, left: number, top: number, width: number, height: number, radius: string) {
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    element.style.borderRadius = radius;
  }

  function render() {
    if (talk.value !== shownTalk) {
      applyTalk();
      length.jump(measure());
    }
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

  createEffect(push, (pushed) => {
    talk.to(pushed ? 1 : 0);
    if (ready) motion.kick();
  });

  onSettled(() => {
    measureTalk();
    length.jump(measure());
    ready = true;
    motion.kick();
    // New controls, such as the speed, change the length; the pill follows on its spring.
    const observer = new ResizeObserver(() => {
      measureTalk();
      length.to(measure());
      motion.kick();
    });
    observer.observe(face);
    observer.observe(padFace);
    // A new chat width moves the centre: the pill must be placed again.
    observer.observe(dock);
    // Push to talk: the talk key held talks, outside the other controls, and outside a text field when it
    // types. Another key while it is held is a shortcut, such as ⌃⌥→, so the talk stops and sends nothing.
    // A lost key-up, such as at a switch to another window, must not leave the microphone on, and sends
    // nothing when the key held it.
    let holding = false;
    const keyTalks = (event: KeyboardEvent) => {
      const key = props.talkKey.key;
      const target = event.target;
      return (
        completesTalkKey(event, key) &&
        props.talkMode === "push" &&
        props.open !== false &&
        !(talkKeyTypes(key) && typingTarget(target)) &&
        !(talkKeyPresses(key) && target instanceof Element && target.closest("button, a") && !talkPad?.contains(target))
      );
    };
    const down = (event: KeyboardEvent) => {
      if (holding) {
        if (isTalkKeyPart(event.code, props.talkKey.key)) {
          if (props.talkKey.key.code !== null) event.preventDefault();
          return;
        }
        holding = false;
        props.onTalkCancel();
        return;
      }
      if (event.repeat || !keyTalks(event)) return;
      if (props.talkKey.key.code !== null) event.preventDefault();
      holding = true;
      props.onTalkStart();
    };
    const up = (event: KeyboardEvent) => {
      if (!holding || !isTalkKeyPart(event.code, props.talkKey.key)) return;
      if (props.talkKey.key.code !== null) event.preventDefault();
      holding = false;
      props.onTalkEnd();
    };
    const release = () => {
      if (!holding) return props.onTalkEnd();
      holding = false;
      props.onTalkCancel();
    };
    const hidden = () => {
      if (document.hidden) release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      observer.disconnect();
      motion.stop();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
      release();
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
        data-muted={micOff() ? "" : undefined}
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
          {t(phaseLabel())}
        </span>
        <div class="voice-pill-talk-slot" ref={slot}>
          <div class="voice-pill-wave" inert={push() ? true : undefined} ref={wave}>
            <VoiceWaveform
              levels={!push() && (hearing() || props.phase === "speaking") ? props.levels.slice(-PILL_LEVELS) : []}
              class="voice-pill-waveform"
            />
          </div>
          <TalkPad
            ref={(element) => {
              talkPad = element;
            }}
            faceRef={(element) => {
              padFace = element;
            }}
            inactive={!push()}
            talking={props.talking}
            disabled={props.phase === "starting" || props.phase === "offline"}
            levels={push() && (hearing() || props.phase === "speaking") ? props.levels.slice(-PILL_LEVELS) : null}
            talkKey={props.talkKey}
            onStart={() => props.onTalkStart()}
            onEnd={() => props.onTalkEnd()}
          />
        </div>
        <SlidingTabs.Root
          value={props.talkMode}
          onChange={(value: string) => {
            if (isVoiceTalkMode(value)) props.onTalkModeChange(value);
          }}
        >
          <SlidingTabs.List class="voice-pill-modes" aria-label={t("conversation.voice.talkMode")}>
            <For each={TALK_MODES}>
              {(mode) => (
                <SlidingTabs.Trigger value={mode} class="voice-pill-mode" aria-label={t(TALK_MODE_LABELS[mode])}>
                  <Show when={mode === "push"} fallback={<AudioLines aria-hidden="true" />}>
                    <Hand aria-hidden="true" />
                  </Show>
                </SlidingTabs.Trigger>
              )}
            </For>
          </SlidingTabs.List>
        </SlidingTabs.Root>
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
        {/* Push to talk has no mute: the microphone is off until the user holds the talk button. */}
        <div class="voice-pill-mute" inert={push() ? true : undefined}>
          <PillAction text={t("conversation.voice.mute")} pressed={props.muted} onClick={() => props.onToggleMute()}>
            <Show when={props.muted} fallback={<Mic aria-hidden="true" />}>
              <MicOff aria-hidden="true" />
            </Show>
          </PillAction>
        </div>
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
 * Push to talk: hold it with the pointer, or with Enter while it has the focus. It says how to talk, and
 * shows the voice while the user talks or the agent speaks. It takes the accent while it is held.
 */
function TalkPad(props: {
  ref: (element: HTMLButtonElement) => void;
  faceRef: (element: HTMLSpanElement) => void;
  inactive: boolean;
  talking: boolean;
  disabled: boolean;
  /** The voice that is heard now, or null while nobody speaks. */
  levels: readonly number[] | null;
  talkKey: TalkKeyBinding;
  onStart: () => void;
  onEnd: () => void;
}) {
  const { t } = useText();
  return (
    <Button
      ref={props.ref}
      variant="ghost"
      size="sm"
      type="button"
      class="voice-pill-talk"
      aria-label={t("conversation.voice.holdToTalk")}
      aria-pressed={props.talking ? "true" : "false"}
      aria-keyshortcuts={talkKeyAria(props.talkKey.key)}
      disabled={props.disabled}
      inert={props.inactive ? true : undefined}
      onPointerDown={(event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        props.onStart();
      }}
      onPointerUp={() => props.onEnd()}
      onPointerCancel={() => props.onEnd()}
      onLostPointerCapture={() => props.onEnd()}
      onContextMenu={(event: MouseEvent) => event.preventDefault()}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) props.onStart();
      }}
      onKeyUp={(event: KeyboardEvent) => {
        if (event.key === "Enter") props.onEnd();
      }}
    >
      <span class="voice-pill-talk-face" ref={props.faceRef}>
        {/* The hint stays under the waveform, so the pad keeps its width at each press (voice.css). */}
        <span class="voice-pill-talk-row">
          <Mic aria-hidden="true" />
          <span class="voice-pill-talk-hint">{t("conversation.voice.holdToTalk")}</span>
          <TalkKeyCaps binding={props.talkKey} class="voice-pill-talk-key" />
        </span>
        <Show when={props.levels}>{(levels) => <VoiceWaveform levels={levels()} class="voice-pill-waveform" />}</Show>
      </span>
    </Button>
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
