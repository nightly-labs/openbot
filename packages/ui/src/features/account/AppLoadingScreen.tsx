import type { AppTextKey } from "@openbot/i18n";
import { createEffect, createSignal, For, onCleanup, onSettled, untrack } from "solid-js";
import { documentStillFaces } from "../../document-rendering";
import { PlushLoader } from "../../plush-loader";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { type CrewHop, CrewPileStage } from "./CrewPileStage";
import { CrewPile, randomCrewSeed } from "./crew-pile";

const STATUS_EVERY_S = 2.4;
const QUICK_EXIT_S = 0.6;
const EXIT_LIMIT_MS = 3000;
const EXIT_FADE_DELAY_MS = 300;
const MIN_RAIN_S = 2;
const EXIT_ANIMATION = "app-loading-exit";
const THINKING_SIZE = 132;
const ENTER_DELAY_S = 0.25;

const STATUS_LINES = [
  "webClient.loadingLine.wake",
  "webClient.loadingLine.coffee",
  "webClient.loadingLine.tokens",
  "webClient.loadingLine.prompts",
  "webClient.loadingLine.sleepy",
  "webClient.loadingLine.almost",
] as const satisfies readonly AppTextKey[];

const HANDOFF_MS = 1000;

interface PileRun {
  pile: CrewPile;
  start: number;
  screens: object[];
  handedOver: Set<object>;
  leaving: boolean;
  playThrough: boolean;
}

interface PileSeat {
  pile: CrewPile;
  start: number;
  owns: () => boolean;
  alone: () => boolean;
  handOver: () => void;
  playThrough: () => boolean;
  hopOut: () => void;
  leave: () => void;
}

const shared: { run: PileRun | undefined; lastUnmount: number } = {
  run: undefined,
  lastUnmount: Number.NEGATIVE_INFINITY,
};

function newRun(seed: number, reduced: boolean, now: number): PileRun {
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
  ready?: boolean | undefined;
  onExited?: (() => void) | undefined;
  onMountViews?: (() => void) | undefined;
  scene?: "pile" | "thinking" | "quiet";
  seed?: number;
  label?: string;
  title?: string;
  quickExit?: boolean;
  immediate?: boolean;
}

export function AppLoadingScreen(props: AppLoadingScreenProps) {
  const { t } = useText();
  const reducedMotion = prefersReducedMotion() || documentStillFaces();
  const scene = untrack(() => props.scene ?? "pile");
  const pileScene = scene === "pile";
  const seat = pileScene
    ? takeSeat(
        untrack(() => props.seed),
        reducedMotion,
        untrack(() => props.quickExit === false),
      )
    : undefined;
  onCleanup(() => seat?.leave());
  const start = seat?.start ?? performance.now();
  const age = () => (performance.now() - start) / 1000;
  const mountedAt = age();
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

  createEffect(phase, (current) => {
    if (current !== "fade" && current !== "exit") return;
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
      seat.hopOut();
      hopWanted = true;
      rainTimer = setTimeout(() => {
        mountViews();
        hopFrame = requestAnimationFrame(() => setHop(true));
      }, rainLeft);
    },
  );

  function handleHop(started: CrewHop): void {
    if (untrack(phase) !== "loading") return;
    setFadeDelay(started.delay + EXIT_FADE_DELAY_MS);
    setPhase("exit");
    clearTimeout(exitTimer);
    exitTimer = setTimeout(finishExit, started.delay + EXIT_LIMIT_MS);
  }

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
      data-scene={scene}
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
