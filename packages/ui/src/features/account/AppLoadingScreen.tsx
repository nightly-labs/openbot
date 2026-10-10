import { type Block, BloubBot, type BloubBotRef, type StateId } from "@norbert_bodziony/bloub";
import type { AvatarHue } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, onSettled, untrack } from "solid-js";
import { bloubAvatarProfile } from "../../bloub-avatar";
import { ErrorReference } from "../../error-reference";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

/*
 * One clock drives the whole screen, so each run shows the same frames. Each frame is a function of
 * the elapsed time: the faces and the status line. The bots are frozen and drawn with `renderAt`, so
 * they have no clock of their own that can drift. The CSS animations start at the same time as the
 * clock: `--app-loading-at` moves them back to the clock's time when the screen mounts.
 */
const CREW_FPS = 30;
const WAVE_S = 1.6;
const HOP_STAGGER_S = 0.14;
// Three waves: each hopper makes a face in its own wave.
const LOOP_S = WAVE_S * 3;
const STATUS_EVERY_S = LOOP_S / 2;
// One cycle holds 2 blocks per loop and at most 200 blocks, so it lasts about 7 minutes before it
// starts again.
const LOOPS = 90;
// When the app is ready before this time, the screen only fades. The crew does not jump out.
const QUICK_EXIT_S = 0.6;
// The longest exit is 760ms of jumps and the fade. If no `animationend` comes, the screen ends after
// this time, so it cannot cover the app.
const EXIT_LIMIT_MS = 2500;
const EXIT_ANIMATION = "app-loading-exit";

const STATUS_LINES = [
  "webClient.loadingLine.wake",
  "webClient.loadingLine.coffee",
  "webClient.loadingLine.tokens",
  "webClient.loadingLine.prompts",
  "webClient.loadingLine.sleepy",
  "webClient.loadingLine.almost",
] as const satisfies readonly AppTextKey[];

// Only states that keep the body. The others, such as `orbit`, `burst`, `sleep` and `alert`, replace
// it with dots or a mark.
const HOPPER_LOOKS: ReadonlyArray<{ seed: string; hue: AvatarHue; face: StateId }> = [
  { seed: "crew-hopper-one", hue: 215, face: "wink" },
  { seed: "crew-hopper-two", hue: 320, face: "wide" },
  { seed: "crew-hopper-three", hue: 55, face: "wink" },
];

/** Idle, and one face while this hopper is in the air in its own wave. */
function hopperCycle(index: number, face: StateId): Block[] {
  const lead = index * (WAVE_S + HOP_STAGGER_S);
  const blocks: Block[] = lead > 0 ? [{ state: "idle", duration: lead }] : [];
  for (let loop = 0; loop < LOOPS; loop += 1) {
    blocks.push({ state: face, duration: WAVE_S }, { state: "idle", duration: LOOP_S - WAVE_S });
  }
  return blocks;
}

const HOPPERS = HOPPER_LOOKS.map((look, index) => ({
  index,
  profile: bloubAvatarProfile(look.seed, look.hue),
  cycle: hopperCycle(index, look.face),
}));
const SLEEPER = bloubAvatarProfile("crew-sleeper", 185);

function cycleLength(blocks: readonly Block[]): number {
  return blocks.reduce((total, block) => total + block.duration, 0);
}

// Three small scribbled "z" marks that float up from the sleeper's head, one after the other.
const Z_POINTS = "1.5 1.5 8.5 1.5 1.5 8.5 8.5 8.5";
const SNORE_MARKS = [0, 1, 2];

/*
 * The screens on one page share one clock. The `/app` page shows a screen while the web client's code
 * loads, and the web client then shows its own. The second screen continues the loop of the first,
 * so the crew does not start again at the handoff.
 */
const HANDOFF_MS = 1000;
const sharedClock = { start: 0, screens: 0, lastUnmount: Number.NEGATIVE_INFINITY };

/** The clock time in seconds for a screen that mounts now. A new run starts when no screen is shown. */
function clockTime(now: number): number {
  if (sharedClock.screens === 0 && now - sharedClock.lastUnmount > HANDOFF_MS) sharedClock.start = now;
  return (now - sharedClock.start) / 1000;
}

/** Keeps the run going while this screen is shown. Returns the cleanup that ends it. */
function joinClock(): () => void {
  sharedClock.screens += 1;
  return () => {
    sharedClock.screens -= 1;
    sharedClock.lastUnmount = performance.now();
  };
}

function snapToFrame(seconds: number): number {
  return Math.floor(seconds * CREW_FPS) / CREW_FPS;
}

export interface AppLoadingScreenProps {
  /** The app is ready: the crew jumps out and the screen fades. Remove the screen in `onExited`. */
  ready?: boolean;
  onExited?: () => void;
  /** Stop the clock and show the frame at this time, in seconds. */
  at?: number;
  /** What the screen waits for, for a screen reader. The default is the app load. */
  label?: string;
  title?: string;
  detail?: string;
  /** The code of the failure in `detail`, for a user to copy into a report. */
  reference?: string | null;
  actions?: JSX.Element;
}

export function AppLoadingScreen(props: AppLoadingScreenProps) {
  const { t } = useText();
  // A screen stays in one mode: it shows one frame or it plays.
  const scrub = untrack(() => props.at !== undefined);
  const mountedAt = scrub ? 0 : snapToFrame(clockTime(performance.now()));
  const [clock, setClock] = createSignal(mountedAt);
  const reducedMotion = prefersReducedMotion();
  const bots: Array<{ ref: BloubBotRef; length: number }> = [];
  const seconds = () => props.at ?? clock();
  const status = () => STATUS_LINES[Math.floor(seconds() / STATUS_EVERY_S) % STATUS_LINES.length] ?? STATUS_LINES[0];
  // The clock stops when the app is ready, so the exit that it selects cannot change.
  const phase = () => {
    if (!props.ready) return "loading";
    return seconds() < QUICK_EXIT_S ? "fade" : "exit";
  };
  let frameRequest = 0;
  let stopped = false;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let exited = false;
  let root: HTMLElement | undefined;

  function finishExit(): void {
    if (exited) return;
    exited = true;
    clearTimeout(exitTimer);
    props.onExited?.();
  }

  function stopClock(): void {
    stopped = true;
    cancelAnimationFrame(frameRequest);
  }

  function addBot(cycle: readonly Block[]) {
    return (ref: BloubBotRef) => bots.push({ ref, length: cycleLength(cycle) });
  }

  createEffect(seconds, (time) => {
    if (reducedMotion) return;
    for (const bot of bots) bot.ref.renderAt(time % bot.length);
  });

  createEffect(
    () => props.ready,
    (ready) => {
      if (!ready) return;
      stopClock();
      exitTimer ??= setTimeout(finishExit, EXIT_LIMIT_MS);
      // Without the stylesheet, or in a test DOM, the exit does not animate: end the screen now.
      if (root && !getComputedStyle(root).animationName.includes(EXIT_ANIMATION)) queueMicrotask(finishExit);
    },
  );

  onSettled(() => {
    if (scrub) return () => clearTimeout(exitTimer);
    const leaveClock = joinClock();
    const start = performance.now();
    const tick = (now: number) => {
      frameRequest = requestAnimationFrame(tick);
      // Snap to whole frames, so a given time always draws the same frame.
      setClock(snapToFrame(mountedAt + Math.max(0, now - start) / 1000));
    };
    if (!stopped) frameRequest = requestAnimationFrame(tick);
    return () => {
      stopClock();
      clearTimeout(exitTimer);
      leaveClock();
    };
  });

  function handleAnimationEnd(event: AnimationEvent): void {
    if (event.animationName === EXIT_ANIMATION && event.target === event.currentTarget) finishExit();
  }

  return (
    <main
      ref={(element) => {
        root = element;
      }}
      class="app-loading"
      style={{
        "--app-loading-wave": `${WAVE_S}s`,
        "--app-loading-stagger": `${HOP_STAGGER_S}s`,
        "--app-loading-at": `${props.at ?? mountedAt}s`,
      }}
      data-phase={phase()}
      data-scrub={scrub ? "true" : undefined}
      role="status"
      aria-live="polite"
      aria-busy={props.ready ? "false" : "true"}
      onAnimationEnd={handleAnimationEnd}
    >
      <span class="sr-only">{props.label ?? t("webClient.loading")}</span>
      <div class="app-loading-stage">
        <div class="app-loading-row" aria-hidden="true">
          <For each={HOPPERS}>
            {(hopper) => (
              <div class="app-loading-agent" style={{ "--app-loading-index": hopper.index }}>
                <div class="app-loading-body">
                  <BloubBot
                    size={100}
                    shape={hopper.profile.shape}
                    color={hopper.profile.color}
                    expression={hopper.profile.expression}
                    cycle={hopper.cycle}
                    frozenAt={0}
                    ref={addBot(hopper.cycle)}
                    ariaLabel=""
                    class="app-loading-bot"
                  />
                </div>
              </div>
            )}
          </For>
          <div class="app-loading-agent" data-sleeper="true">
            <div class="app-loading-snore">
              <For each={SNORE_MARKS}>
                {(mark) => (
                  <span class="app-loading-z" style={{ "--app-loading-z-index": mark }}>
                    <svg class="app-loading-z-mark" viewBox="0 0 10 10" aria-hidden="true">
                      <polyline points={Z_POINTS} />
                    </svg>
                  </span>
                )}
              </For>
            </div>
            {/* The clock does not draw the sleeper: `idle` blinks, and a blink on a sleepy face looks
                like a twitch. It keeps its first pose, and only its CSS breath moves it. */}
            <div class="app-loading-body">
              <BloubBot
                size={100}
                shape={SLEEPER.shape}
                color={SLEEPER.color}
                expression="somnolent"
                frozenAt={0}
                ariaLabel=""
                class="app-loading-bot"
              />
            </div>
          </div>
        </div>
        <p class="app-loading-status">
          {props.title ?? <For each={[status()]}>{(line) => <span class="app-loading-line">{t(line)}</span>}</For>}
        </p>
        {props.detail && <p class="server-connection-detail">{props.detail}</p>}
        <ErrorReference reference={props.reference} />
        {props.actions && <div class="server-connection-actions">{props.actions}</div>}
      </div>
    </main>
  );
}

/** The length of the crew's loop in seconds, for a story that shows one frame. */
export const APP_LOADING_LOOP_S = LOOP_S;
/** The frame rate of the crew's clock, for a story that shows one frame. */
export const APP_LOADING_FPS = CREW_FPS;
