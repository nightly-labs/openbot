import type { AppTextKey } from "@openbot/i18n";
import { RadioGroup } from "@openbot/ui";
import type { DitheringShape, DitheringType, ShaderMount } from "@paper-design/shaders";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, onCleanup } from "solid-js";
import { useText } from "../../text";
import { SOUND_THEMES, type SoundChoice } from "./app-settings";

const SOUND_CHOICES = ["off", ...SOUND_THEMES] as const satisfies readonly SoundChoice[];

const CHOICE_TEXT = {
  off: { name: "settings.soundTheme.off", hint: "settings.soundTheme.offHint" },
  default: { name: "settings.soundTheme.warm", hint: "settings.soundTheme.warmHint" },
  mech: { name: "settings.soundTheme.mech", hint: "settings.soundTheme.mechHint" },
  bubble: { name: "settings.soundTheme.bubble", hint: "settings.soundTheme.bubbleHint" },
  press: { name: "settings.soundTheme.press", hint: "settings.soundTheme.pressHint" },
} as const satisfies Record<SoundChoice, { name: AppTextKey; hint: AppTextKey }>;

/** The dither pattern of each tile. The colors come from the tile's CSS, so they stay brand tokens. */
const CHOICE_PATTERN = {
  off: { shape: "dots", type: "8x8", scale: 1.4 },
  default: { shape: "simplex", type: "4x4", scale: 0.9 },
  mech: { shape: "wave", type: "2x2", scale: 1.1 },
  bubble: { shape: "ripple", type: "4x4", scale: 0.8 },
  press: { shape: "sphere", type: "8x8", scale: 1 },
} as const satisfies Record<SoundChoice, { shape: DitheringShape; type: DitheringType; scale: number }>;

const IDLE_SPEED = 0.12;
const HOVER_SPEED = 0.5;
const SELECTED_SPEED = 0.6;
const PICKED_SPEED = 3;
const PICKED_BURST_MS = 480;

export interface SoundThemePickerProps {
  value: SoundChoice;
  onChange: (value: SoundChoice) => void;
  /** Called when the user picks the selected choice again, so its preview plays again. */
  onReplay?: (value: SoundChoice) => void;
  class?: string;
}

/** Sound feedback off, or on in one sound theme. Each choice shows a moving dither tile. */
export function SoundThemePicker(props: SoundThemePickerProps): JSX.Element {
  const { t } = useText();
  // Only a choice that the user makes pops its tile, not the value the picker opens with.
  const [picked, setPicked] = createSignal<SoundChoice>();
  let replayFrame = 0;
  // A radio group reports no change for the selected choice. The pick is cleared for one frame, so
  // the pop and the fast spin start again.
  const replay = (choice: SoundChoice) => {
    if (props.value !== choice) return;
    setPicked(undefined);
    cancelAnimationFrame(replayFrame);
    replayFrame = requestAnimationFrame(() => setPicked(choice));
    props.onReplay?.(choice);
  };
  onCleanup(() => cancelAnimationFrame(replayFrame));
  return (
    <RadioGroup.Root
      class={props.class ? `sound-theme-picker ${props.class}` : "sound-theme-picker"}
      aria-label={t("settings.soundTheme.label")}
      value={props.value}
      onChange={(value) => {
        const choice = SOUND_CHOICES.find((option) => option === value);
        if (!choice) return;
        setPicked(choice);
        props.onChange(choice);
      }}
    >
      <For each={SOUND_CHOICES}>
        {(choice) => {
          const [hovered, setHovered] = createSignal(false);
          return (
            <RadioGroup.Item
              class="sound-theme-option"
              value={choice}
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
            >
              <RadioGroup.ItemInput
                onKeyDown={(event) => {
                  if (event.key === " ") replay(choice);
                }}
              />
              {/* The control selects after this handler, so `props.value` is still the earlier choice. */}
              <RadioGroup.ItemControl
                class="sound-theme-card"
                data-popped={picked() === choice ? "" : undefined}
                onClick={() => replay(choice)}
              >
                <DitherTile
                  choice={choice}
                  selected={props.value === choice}
                  hovered={hovered()}
                  picked={picked() === choice}
                />
                <span class="sound-theme-text">
                  <RadioGroup.ItemLabel class="sound-theme-name">{t(CHOICE_TEXT[choice].name)}</RadioGroup.ItemLabel>
                  <RadioGroup.ItemDescription class="sound-theme-hint">
                    {t(CHOICE_TEXT[choice].hint)}
                  </RadioGroup.ItemDescription>
                </span>
              </RadioGroup.ItemControl>
            </RadioGroup.Item>
          );
        }}
      </For>
    </RadioGroup.Root>
  );
}

function DitherTile(props: { choice: SoundChoice; selected: boolean; hovered: boolean; picked: boolean }) {
  let host: HTMLDivElement | undefined;
  let mount: ShaderMount | undefined;
  // Plain copies of the props, so the shader callbacks read them without tracking.
  let selected = false;
  let hovered = false;
  let bursting = false;
  let reducedMotion: MediaQueryList | undefined;
  const speed = () => {
    if (reducedMotion?.matches) return 0;
    if (bursting) return PICKED_SPEED;
    if (selected) return SELECTED_SPEED;
    return hovered ? HOVER_SPEED : IDLE_SPEED;
  };

  createEffect(
    () => props.choice,
    (choice) => {
      const element = host;
      if (!element || !window.matchMedia || !window.IntersectionObserver) return;
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedMotion = motion;
      let visible = false;
      let disposed = false;
      let generation = 0;
      let failed = false;
      const stop = () => {
        generation += 1;
        mount?.dispose();
        mount = undefined;
      };
      const update = async () => {
        if (disposed || !visible || document.hidden) {
          stop();
          return;
        }
        if (mount) {
          mount.setSpeed(speed());
          return;
        }
        if (failed) return;
        const attempt = ++generation;
        try {
          const {
            DitheringShapes,
            DitheringTypes,
            ShaderFitOptions,
            ShaderMount,
            defaultPatternSizing,
            ditheringFragmentShader,
            getShaderColorFromString,
          } = await import("@paper-design/shaders");
          if (disposed || attempt !== generation) return;
          const style = getComputedStyle(element);
          const pattern = CHOICE_PATTERN[choice];
          mount = new ShaderMount(
            element,
            ditheringFragmentShader,
            {
              u_colorBack: getShaderColorFromString(style.backgroundColor),
              u_colorFront: getShaderColorFromString(style.color),
              u_shape: DitheringShapes[pattern.shape],
              u_type: DitheringTypes[pattern.type],
              u_pxSize: 3,
              u_fit: ShaderFitOptions.cover,
              u_scale: pattern.scale,
              u_rotation: defaultPatternSizing.rotation,
              u_originX: defaultPatternSizing.originX,
              u_originY: defaultPatternSizing.originY,
              u_offsetX: defaultPatternSizing.offsetX,
              u_offsetY: defaultPatternSizing.offsetY,
              u_worldWidth: defaultPatternSizing.worldWidth,
              u_worldHeight: defaultPatternSizing.worldHeight,
            },
            undefined,
            speed(),
          );
        } catch {
          failed = true;
          stop();
        }
      };
      const refresh = () => {
        void update();
      };
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false;
        refresh();
      });
      observer.observe(element);
      motion.addEventListener("change", refresh);
      document.addEventListener("visibilitychange", refresh);
      const contextLost = () => {
        failed = true;
        stop();
      };
      element.addEventListener("webglcontextlost", contextLost, true);
      return () => {
        disposed = true;
        stop();
        observer.disconnect();
        motion.removeEventListener("change", refresh);
        document.removeEventListener("visibilitychange", refresh);
        element.removeEventListener("webglcontextlost", contextLost, true);
      };
    },
  );

  createEffect(
    () => [props.selected, props.hovered] as const,
    ([nextSelected, nextHovered]) => {
      selected = nextSelected;
      hovered = nextHovered;
      mount?.setSpeed(speed());
    },
  );

  // A new choice spins its tile fast for a moment, in time with the preview sound.
  createEffect(
    () => props.picked && props.selected,
    (burst) => {
      if (!burst) return;
      bursting = true;
      mount?.setSpeed(speed());
      const timer = window.setTimeout(() => {
        bursting = false;
        mount?.setSpeed(speed());
      }, PICKED_BURST_MS);
      return () => {
        window.clearTimeout(timer);
        bursting = false;
      };
    },
  );

  return (
    <div
      ref={(element) => {
        host = element;
      }}
      class="sound-theme-dither"
      data-choice={props.choice}
      aria-hidden="true"
    />
  );
}
