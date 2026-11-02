import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, For, onSettled, untrack } from "solid-js";
import { ErrorReference } from "../../error-reference";
import { PlushLoader } from "../../plush-loader";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { CrewPileStage } from "./CrewPileStage";
import { CrewPile, randomCrewSeed } from "./crew-pile";

/*
 * The app loading screen. In the `pile` scene, a different crew of felt plushes rains into a pile on
 * each run, and the lilac OpenBot plush lands on top; a user can grab and throw them. When the app is
 * ready, the crew hop out and the screen fades. The `thinking` scene shows the lilac plush, which
 * watches three felt balls bounce. Joke status lines change below, unless the screen has a title.
 */
const STATUS_EVERY_S = 2.4;
// When the app is ready before this time, the screen only fades. The crew do not hop out.
const QUICK_EXIT_S = 0.6;
// The longest exit is the rush to the end of the intro, the hops and the fade. If no `animationend`
// comes, the screen ends after this time, so it cannot cover the app.
const EXIT_LIMIT_MS = 2500;
const EXIT_ANIMATION = "app-loading-exit";
const THINKING_SIZE = 132;

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
 * so the crew do not fall again at the handoff. Only the first screen that is still shown moves it.
 */
const HANDOFF_MS = 1000;

interface PileSeat {
  pile: CrewPile;
  /** When the run started, from `performance.now()`. */
  start: number;
  owns: () => boolean;
  /** No other screen shows this pile, so its crew can hop out. */
  alone: () => boolean;
  leave: () => void;
}

const shared: { pile: CrewPile | undefined; start: number; screens: object[]; lastUnmount: number } = {
  pile: undefined,
  start: 0,
  screens: [],
  lastUnmount: Number.NEGATIVE_INFINITY,
};

/** A pile for a screen that mounts now. A screen with its own seed gets its own pile. */
function takeSeat(seed: number | undefined, reduced: boolean): PileSeat {
  const now = performance.now();
  if (seed !== undefined) {
    return { pile: new CrewPile(seed, reduced), start: now, owns: () => true, alone: () => true, leave: () => {} };
  }
  const recent = shared.screens.length > 0 || now - shared.lastUnmount <= HANDOFF_MS;
  const reusable = shared.pile && shared.pile.phase !== "exit" && shared.pile.reduced === reduced;
  if (!(recent && reusable) || !shared.pile) {
    shared.pile = new CrewPile(randomCrewSeed(), reduced);
    shared.start = now;
  }
  const token = {};
  shared.screens.push(token);
  return {
    pile: shared.pile,
    start: shared.start,
    owns: () => shared.screens[0] === token,
    alone: () => shared.screens.length === 1,
    leave: () => {
      shared.screens = shared.screens.filter((screen) => screen !== token);
      shared.lastUnmount = performance.now();
    },
  };
}

type Phase = "loading" | "leaving" | "fade" | "exit";

export interface AppLoadingScreenProps {
  /** The app is ready: the crew hop out and the screen fades. Remove the screen in `onExited`. */
  ready?: boolean;
  onExited?: () => void;
  /** `pile` is the crew pile-up. `thinking` is the lilac plush with its three balls. */
  scene?: "pile" | "thinking";
  /** The same seed always makes the same crew, for a story. The default is a new crew each run. */
  seed?: number;
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
  const reducedMotion = prefersReducedMotion();
  // A screen keeps its scene and its pile.
  const pileScene = untrack(() => props.scene !== "thinking");
  const seat = pileScene
    ? takeSeat(
        untrack(() => props.seed),
        reducedMotion,
      )
    : undefined;
  const start = seat?.start ?? performance.now();
  const age = () => (performance.now() - start) / 1000;
  const mountedAt = age();
  const [clock, setClock] = createSignal(mountedAt);
  const [phase, setPhase] = createSignal<Phase>("loading");
  const status = () => STATUS_LINES[Math.floor(clock() / STATUS_EVERY_S) % STATUS_LINES.length] ?? STATUS_LINES[0];
  let frameRequest = 0;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let exited = false;
  let root: HTMLElement | undefined;

  function finishExit(): void {
    if (exited) return;
    exited = true;
    clearTimeout(exitTimer);
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
      if (!ready || untrack(phase) !== "loading") return;
      cancelAnimationFrame(frameRequest);
      exitTimer ??= setTimeout(finishExit, EXIT_LIMIT_MS);
      const hop = seat && !reducedMotion && seat.owns() && seat.alone() && age() >= QUICK_EXIT_S;
      setPhase(hop ? "leaving" : "fade");
    },
  );

  /** The owner of the pile moves it, and the screen fades when the crew start to hop out. */
  function onFrame(seconds: number): void {
    if (!seat?.owns()) return;
    const current = phase();
    seat.pile.tick(seconds, current === "leaving");
    if (current === "leaving" && seat.pile.phase === "exit") setPhase("exit");
  }

  onSettled(() => {
    const tick = () => {
      frameRequest = requestAnimationFrame(tick);
      setClock(age());
    };
    if (!props.ready) frameRequest = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frameRequest);
      clearTimeout(exitTimer);
      seat?.leave();
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
      style={{ "--app-loading-at": `${mountedAt}s` }}
      data-scene={pileScene ? "pile" : "thinking"}
      data-phase={phase()}
      role="status"
      aria-live="polite"
      aria-busy={props.ready ? "false" : "true"}
      onAnimationEnd={handleAnimationEnd}
    >
      <span class="sr-only">{props.label ?? t("webClient.loading")}</span>
      <div class="app-loading-stage">
        {seat ? (
          <CrewPileStage pile={seat.pile} onFrame={onFrame} />
        ) : (
          <PlushLoader layout="stack" size={THINKING_SIZE} class="app-loading-thinking" />
        )}
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
