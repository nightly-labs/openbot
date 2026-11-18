import type { AppTextKey } from "@openbot/i18n";
import { createEffect, createSignal, For, onCleanup, onSettled, untrack } from "solid-js";
import { PlushLoader } from "../../plush-loader";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { type CrewHop, CrewPileStage } from "./CrewPileStage";
import { CrewPile, randomCrewSeed } from "./crew-pile";

/*
 * The app loading screen. In the `pile` scene, a different crew of felt plushes rains into the screen
 * on each run until it is full. The compositor plays the
 * pile, so it moves also while the app is busy. When the app is ready, its heavy views mount behind
 * the screen, then the crew hop out while the screen fades. The `thinking` scene shows the lilac plush, which
 * watches three felt balls bounce, and joke status lines change below it unless the screen has a title.
 * The pile scene shows no text: its label is for a screen reader only.
 */
const STATUS_EVERY_S = 2.4;
// When the app is ready before this time, the screen only fades. The crew do not hop out.
const QUICK_EXIT_S = 0.6;
// If no `animationend` comes, the screen ends this long after its fade or hop should start, so it
// cannot cover the app. The heavy views mount before the hop, so the hop can start late.
const EXIT_LIMIT_MS = 3000;
// The fade starts this long after the first hop.
const EXIT_FADE_DELAY_MS = 300;
// A screen that makes the hop shows the rain for at least this time, also when the app is ready sooner.
const MIN_RAIN_S = 2;
const EXIT_ANIMATION = "app-loading-exit";
const THINKING_SIZE = 132;
// The wait before the stage shows, as in `app-loading-screen.css`.
const ENTER_DELAY_S = 0.25;

const STATUS_LINES = [
  "webClient.loadingLine.wake",
  "webClient.loadingLine.coffee",
  "webClient.loadingLine.tokens",
  "webClient.loadingLine.prompts",
  "webClient.loadingLine.sleepy",
  "webClient.loadingLine.almost",
] as const satisfies readonly AppTextKey[];

/*
 * The screens on one page share one pile. The `/app` page shows a screen while the web client's code
 * loads, and the web client then shows its own. The second screen continues the pile of the first,
 * so the crew do not fall again at the handoff. Only the first screen that still waits moves the
 * pile. A screen that is ready while another screen still shows the pile only fades: it hands the pile
 * to the next screen, which makes the hop when it is ready. A pile whose crew started to hop out is
 * not shared again: a new screen gets a new pile.
 */
const HANDOFF_MS = 1000;

interface PileRun {
  pile: CrewPile;
  /** When the run started, from `performance.now()`. */
  start: number;
  /** The screens that show this pile, in mount order. */
  screens: object[];
  /** The screens that are ready and gave the pile to the next screen. */
  handedOver: Set<object>;
  leaving: boolean;
  /** A screen of this run turned off the quick exit, so the screens after it also make the hop. */
  playThrough: boolean;
}

interface PileSeat {
  pile: CrewPile;
  start: number;
  owns: () => boolean;
  /** No other screen that still waits shows this pile, so its crew can hop out. */
  alone: () => boolean;
  /** This screen is ready and fades: the next screen moves the pile and makes the hop. */
  handOver: () => void;
  /** The crew hop out also when the app is ready at once. */
  playThrough: () => boolean;
  /** The crew hop out: no new screen can show this pile. */
  hopOut: () => void;
  leave: () => void;
}

const shared: { run: PileRun | undefined; lastUnmount: number } = {
  run: undefined,
  lastUnmount: Number.NEGATIVE_INFINITY,
};

function newRun(seed: number, reduced: boolean, now: number): PileRun {
  // The screen fits the pile to its own size before the pile moves. The window is the best guess.
  const room = typeof window === "undefined" ? undefined : { width: window.innerWidth, height: window.innerHeight };
  return {
    pile: new CrewPile(seed, reduced, room),
    start: now,
    screens: [],
    handedOver: new Set(),
    leaving: false,
    playThrough: false,
  };
}

/** A pile for a screen that mounts now. A screen with its own seed gets its own pile. */
function takeSeat(seed: number | undefined, reduced: boolean, playThrough: boolean): PileSeat {
  const now = performance.now();
  let run: PileRun;
  if (seed !== undefined) {
    run = newRun(seed, reduced, now);
  } else {
    const last = shared.run;
    const recent = last && (last.screens.length > 0 || now - shared.lastUnmount <= HANDOFF_MS);
    const reusable = last && !last.leaving && last.pile.reduced === reduced;
    run = last && recent && reusable ? last : newRun(randomCrewSeed(), reduced, now);
    shared.run = run;
  }
  const token = {};
  run.screens.push(token);
  if (playThrough) run.playThrough = true;
  // The screens that still wait. When all are ready, the first screen keeps the pile.
  const waiting = () => run.screens.filter((screen) => !run.handedOver.has(screen));
  return {
    pile: run.pile,
    start: run.start,
    owns: () => (waiting()[0] ?? run.screens[0]) === token,
    alone: () => waiting().length === 1,
    handOver: () => {
      run.handedOver.add(token);
    },
    playThrough: () => run.playThrough,
    hopOut: () => {
      run.leaving = true;
    },
    leave: () => {
      run.screens = run.screens.filter((screen) => screen !== token);
      run.handedOver.delete(token);
      shared.lastUnmount = performance.now();
    },
  };
}

type Phase = "loading" | "fade" | "exit";

export interface AppLoadingScreenProps {
  /** The app is ready: the crew hop out and the screen fades. Remove the screen in `onExited`. */
  ready?: boolean | undefined;
  onExited?: (() => void) | undefined;
  /**
   * Heavy views can mount now. The screen still covers the window, and the compositor keeps the crew
   * moving while the views mount. The crew hop out on the first frame after. A screen without the hop
   * calls this when its fade starts: the compositor runs the fade.
   */
  onMountViews?: (() => void) | undefined;
  /** `pile` is the crew pile-up. `thinking` is the lilac plush with its three balls. */
  scene?: "pile" | "thinking";
  /** The same seed always makes the same crew, for a story. The default is a new crew each run. */
  seed?: number;
  /** What the screen waits for, for a screen reader. The default is the app load. */
  label?: string;
  /** The line under the plush in the `thinking` scene. The default is a joke status line that changes. */
  title?: string;
  /**
   * When false, the crew rain in and hop out also when the app is ready at once, as on a window reload.
   * The default only fades a screen that was ready quickly.
   */
  quickExit?: boolean;
  /**
   * The stage shows at once. The default waits a short time, so a fast load does not flash it. Use it
   * for a screen that is sure to stay, such as one that takes the place of another screen.
   */
  immediate?: boolean;
}

export function AppLoadingScreen(props: AppLoadingScreenProps) {
  const { t } = useText();
  const reducedMotion = prefersReducedMotion();
  // A screen keeps its scene and its pile.
  const pileScene = untrack(() => props.scene !== "thinking");
  const seat = pileScene
    ? takeSeat(
        untrack(() => props.seed),
        reducedMotion,
        untrack(() => props.quickExit === false),
      )
    : undefined;
  // A screen can be disposed before it settles, so the seat is given back on cleanup.
  onCleanup(() => seat?.leave());
  const start = seat?.start ?? performance.now();
  const age = () => (performance.now() - start) / 1000;
  const mountedAt = age();
  // An immediate screen starts as if its stage had waited already.
  const enterAt = untrack(() => props.immediate) ? Math.max(mountedAt, ENTER_DELAY_S) : mountedAt;
  const [clock, setClock] = createSignal(mountedAt);
  const [phase, setPhase] = createSignal<Phase>("loading");
  const status = () => STATUS_LINES[Math.floor(clock() / STATUS_EVERY_S) % STATUS_LINES.length] ?? STATUS_LINES[0];
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let rainTimer: ReturnType<typeof setTimeout> | undefined;
  let hopFrame = 0;
  let exited = false;
  let viewsMounted = false;
  // The app is ready and the crew will hop out.
  let hopWanted = false;
  const [hop, setHop] = createSignal(false);
  const [fadeDelay, setFadeDelay] = createSignal(EXIT_FADE_DELAY_MS);
  let root: HTMLElement | undefined;

  function mountViews(): void {
    if (viewsMounted) return;
    viewsMounted = true;
    props.onMountViews?.();
  }

  function finishExit(): void {
    if (exited) return;
    exited = true;
    clearTimeout(exitTimer);
    mountViews();
    props.onExited?.();
  }

  // The effect runs after the DOM shows the new phase, so the computed style has its animation.
  createEffect(phase, (current) => {
    if (current !== "fade" && current !== "exit") return;
    // Without the stylesheet, or in a test DOM, the exit does not animate: end the screen now.
    if (root && !getComputedStyle(root).animationName.includes(EXIT_ANIMATION)) queueMicrotask(finishExit);
  });

  createEffect(
    () => props.ready,
    (ready) => {
      if (!ready || untrack(phase) !== "loading" || hopWanted) return;
      clearTimeout(statusTimer);
      const quick = !seat?.playThrough() && age() < QUICK_EXIT_S;
      const hopOut = seat && !reducedMotion && seat.owns() && seat.alone() && !quick;
      const rainLeft = hopOut ? Math.max(0, MIN_RAIN_S - age()) * 1000 : 0;
      exitTimer ??= setTimeout(finishExit, rainLeft + EXIT_LIMIT_MS);
      if (seat && !hopOut && !seat.alone()) seat.handOver();
      if (!hopOut) {
        setPhase("fade");
        return;
      }
      // No new screen joins this pile. After the minimum rain, the heavy views mount while the
      // compositor plays the pile, and the crew hop out on the first frame after the mount.
      seat.hopOut();
      hopWanted = true;
      rainTimer = setTimeout(() => {
        mountViews();
        hopFrame = requestAnimationFrame(() => setHop(true));
      }, rainLeft);
    },
  );

  /** The rest of the rain plays fast, then the crew hop out. The screen fades while they hop. */
  function handleHop(started: CrewHop): void {
    if (untrack(phase) !== "loading") return;
    setFadeDelay(started.delay + EXIT_FADE_DELAY_MS);
    setPhase("exit");
    clearTimeout(exitTimer);
    exitTimer = setTimeout(finishExit, started.delay + EXIT_LIMIT_MS);
  }

  // The status line changes at each step of the run's clock, so screens on one pile show the same line.
  onSettled(() => {
    const next = () => {
      const now = age();
      setClock(now);
      statusTimer = setTimeout(next, (STATUS_EVERY_S - (now % STATUS_EVERY_S)) * 1000 + 16);
    };
    if (!props.ready && !pileScene) next();
    return () => {
      clearTimeout(statusTimer);
      clearTimeout(exitTimer);
      clearTimeout(rainTimer);
      cancelAnimationFrame(hopFrame);
    };
  });

  // A screen without the hop lets heavy views mount when its fade starts.
  function handleAnimationStart(event: AnimationEvent): void {
    if (event.animationName === EXIT_ANIMATION && event.target === event.currentTarget) mountViews();
  }

  function handleAnimationEnd(event: AnimationEvent): void {
    if (event.animationName === EXIT_ANIMATION && event.target === event.currentTarget) finishExit();
  }

  return (
    <main
      ref={(element) => {
        root = element;
      }}
      class="app-loading"
      style={{ "--app-loading-at": `${enterAt}s`, "--app-loading-exit-delay": `${fadeDelay()}ms` }}
      data-scene={pileScene ? "pile" : "thinking"}
      data-phase={phase()}
      role="status"
      aria-live="polite"
      aria-busy={props.ready ? "false" : "true"}
      onAnimationStart={handleAnimationStart}
      onAnimationEnd={handleAnimationEnd}
    >
      <span class="sr-only">{props.label ?? t("webClient.loading")}</span>
      <div class="app-loading-stage">
        {seat ? (
          <CrewPileStage pile={seat.pile} start={seat.start} hop={hop()} onHop={handleHop} />
        ) : (
          <PlushLoader layout="stack" size={THINKING_SIZE} />
        )}
        {!pileScene && (
          <p class="app-loading-status">
            {props.title ?? <For each={[status()]}>{(line) => <span class="app-loading-line">{t(line)}</span>}</For>}
          </p>
        )}
      </div>
    </main>
  );
}
