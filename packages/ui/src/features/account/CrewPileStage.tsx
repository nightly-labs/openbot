import type { BotExpression, ExpressionId } from "@norbert_bodziony/bloub";
import { PLUSH_CHARACTER_BY_ID, PlushBot } from "@norbert_bodziony/bloub/plush";
import { createEffect, createSignal, For, flush, onSettled, untrack } from "solid-js";
import type { CrewFace, CrewFilm, CrewMember, CrewPile } from "./crew-pile";

/** The face of a crew plush at rest: its character's own face, as PlushBot shows without an expression. */
function restFace(member: CrewMember): BotExpression | undefined {
  return PLUSH_CHARACTER_BY_ID.get(member.character)?.face;
}

function crewExpression(member: CrewMember, face: CrewFace): BotExpression | ExpressionId {
  if (face.happy) return "heureux";
  return restFace(member) ?? "neutre";
}

/** The elements of one plush: its box, which the film moves, and the squash inside it. */
interface CrewRig {
  plush: HTMLElement;
  squash: HTMLElement;
}

/** The crew hop out after `delay` ms, when the rest of the rain has played, and they are out after `length` ms more. */
export interface CrewHop {
  delay: number;
  length: number;
}

interface CrewPlayer {
  hopOut: () => CrewHop;
  stop: () => void;
}

/**
 * The intro animations hold the last pose for this time, so they do not end. When an animation ends
 * on the compositor while the main thread is busy, the plush goes back to the last pose that the main
 * thread drew, until the main thread is free again.
 */
const INTRO_HOLD_S = 3600;

/** The keyframes of a reel that then holds its last pose for `hold` seconds. */
function heldKeyframes(keyframes: readonly Keyframe[], length: number, hold: number): Keyframe[] {
  const share = length / (length + hold);
  const last = keyframes.at(-1);
  const moving = keyframes.map((keyframe) => ({ ...keyframe, offset: (keyframe.offset ?? 1) * share }));
  return last ? [...moving, { ...last, offset: 1 }] : moving;
}

/**
 * The keyframes of the intro played at `rate`, then of the exit, as one animation of `length` seconds.
 * A new animation that starts next to a running one on the same property makes Chrome run both on the
 * main thread, so the hop replaces the intro animation.
 */
function hopKeyframes(
  intro: readonly Keyframe[],
  introLength: number,
  rate: number,
  exit: readonly Keyframe[] | undefined,
  exitLength: number,
): { keyframes: Keyframe[]; length: number } {
  const introPart = introLength / rate;
  const length = introPart + exitLength;
  const at = (time: number) => (length > 0 ? time / length : 1);
  const keyframes = intro.map((keyframe) => ({ ...keyframe, offset: at((keyframe.offset ?? 1) * introPart) }));
  for (const keyframe of exit ?? []) {
    keyframes.push({ ...keyframe, offset: at(introPart + (keyframe.offset ?? 1) * exitLength) });
  }
  return { keyframes, length };
}

/** The keyframes of one breath. More keyframes make it nearer to a sine. */
const BREATH_KEYFRAMES = 24;

function breathKeyframes(film: CrewFilm, index: number): Keyframe[] {
  const { amount, from, period, phases } = film.breathe;
  const first = (2 * Math.PI * from) / period + (phases[index] ?? 0);
  return Array.from({ length: BREATH_KEYFRAMES + 1 }, (_, step) => {
    const breath = amount * Math.sin(first + (2 * Math.PI * step) / BREATH_KEYFRAMES);
    return { scale: `${(1 - breath / 2).toFixed(4)} ${(1 + breath).toFixed(4)}` };
  });
}

/**
 * Plays a film on the rigs, from `start` on the document timeline, so all screens of one run show the
 * same frame. The compositor runs the animations; a frame loop on the main thread changes the faces.
 */
function playFilm(
  film: CrewFilm,
  rigs: readonly CrewRig[],
  start: number,
  show: (index: number, face: CrewFace) => void,
): CrewPlayer {
  const intro: { animation: Animation; element: HTMLElement; keyframes: readonly Keyframe[]; exit?: Keyframe[] }[] = [];
  const breaths: Animation[] = [];
  let exit: Animation[] = [];
  let exitDelay = 0;
  // Where the exit starts in the hop animations, in ms.
  let exitFrom = 0;
  rigs.forEach((rig, index) => {
    const tracks = [
      [rig.plush, film.intro.plushes[index], film.exit.plushes[index]],
      [rig.squash, film.intro.squashes[index], film.exit.squashes[index]],
    ] as const;
    for (const [element, keyframes, exitKeyframes] of tracks) {
      if (!keyframes) continue;
      const animation = element.animate(heldKeyframes(keyframes, film.intro.length, INTRO_HOLD_S), {
        duration: (film.intro.length + INTRO_HOLD_S) * 1000,
        fill: "forwards",
      });
      animation.startTime = start;
      intro.push({ animation, element, keyframes, ...(exitKeyframes ? { exit: exitKeyframes } : {}) });
    }
    // The breath changes the `scale` property, so it adds to the squash of the film.
    const breath = rig.squash.animate(breathKeyframes(film, index), {
      duration: film.breathe.period * 1000,
      delay: film.breathe.from * 1000,
      iterations: Number.POSITIVE_INFINITY,
    });
    breath.startTime = start;
    breaths.push(breath);
    rig.plush.style.visibility = "visible";
  });

  let introCue = 0;
  let exitCue = 0;
  // After a hop during the rain, the rest of the rain plays faster.
  let rush: { at: number; from: number; rate: number } | undefined;
  const introTime = (now: number) => (rush ? rush.from + ((now - rush.at) / 1000) * rush.rate : (now - start) / 1000);

  function exitTime(): number {
    const current = exit[0]?.currentTime;
    return typeof current === "number" ? (current - exitFrom) / 1000 : -1;
  }

  function frame(now: number): void {
    request = requestAnimationFrame(frame);
    const atExit = exitTime();
    if (atExit >= 0) {
      for (let cue = film.exit.faces[exitCue]; cue && cue.at <= atExit; cue = film.exit.faces[++exitCue]) {
        show(cue.index, cue.face);
      }
      return;
    }
    const at = introTime(now);
    for (let cue = film.intro.faces[introCue]; cue && cue.at <= at; cue = film.intro.faces[++introCue]) {
      show(cue.index, cue.face);
    }
  }
  let request = requestAnimationFrame(frame);

  return {
    hopOut() {
      if (exit.length > 0) return { delay: exitDelay, length: film.exit.length * 1000 };
      const now = performance.now();
      const at = introTime(now);
      const left = Math.max(0, film.intro.length - at);
      const rate = left > 0 ? Math.max(film.rush.rate, left / film.rush.time) : 1;
      if (left > 0) rush = { at: now, from: at, rate };
      exitDelay = (left / rate) * 1000;
      exitFrom = (film.intro.length / rate) * 1000;
      // Each hop animation replaces its intro animation in this task, so no frame shows the plush
      // without one. They start at the next frame that the compositor gets.
      const seek = (Math.min(at, film.intro.length) / rate) * 1000;
      exit = intro.map((track) => {
        track.animation.cancel();
        const hop = hopKeyframes(track.keyframes, film.intro.length, rate, track.exit, film.exit.length);
        const animation = track.element.animate(hop.keyframes, { duration: hop.length * 1000, fill: "forwards" });
        animation.currentTime = seek;
        return animation;
      });
      return { delay: exitDelay, length: film.exit.length * 1000 };
    },
    stop() {
      cancelAnimationFrame(request);
      // An element that leaves the document keeps its Web Animations. The breath never ends, so
      // without a cancel the closed screen stays in memory and the page renders each frame (#5144).
      for (const animation of [...intro.map((track) => track.animation), ...breaths, ...exit]) animation.cancel();
    },
  };
}

/** A pile without motion: the still pile, drawn once. */
function showRest(film: CrewFilm, rigs: readonly CrewRig[]): void {
  rigs.forEach((rig, index) => {
    const rest = film.rest[index];
    if (!rest) return;
    rig.plush.style.transform = rest.plush;
    rig.squash.style.transform = rest.squash;
    rig.plush.style.visibility = "visible";
  });
}

export interface CrewPileStageProps {
  pile: CrewPile;
  /** When the run started, from `performance.now()`. The screens of one run show the same frame. */
  start: number;
  /** The crew hop out. Set it once; it does not go back. */
  hop?: boolean;
  /** The hop started. */
  onHop?: (hop: CrewHop) => void;
}

/**
 * Draws a crew pile over the whole screen. The pile records its motion as a film, and the stage plays
 * the film as Web Animations, so the plushes move also while the main thread is busy. The faces are
 * signals, so a plush updates only when its face changes. Nothing on the screen can be grabbed.
 */
export function CrewPileStage(props: CrewPileStageProps) {
  const pile = props.pile;
  const plushes: (HTMLElement | undefined)[] = [];
  const squashes: (HTMLElement | undefined)[] = [];
  const faces: ((face: CrewFace) => void)[] = [];
  // A pile without a film gets a new crew when it fits the screen.
  const [crew, setCrew] = createSignal(pile.crew);
  const [pitSize, setPitSize] = createSignal(pile.pit);
  const [player, setPlayer] = createSignal<CrewPlayer>();
  let frame: HTMLDivElement | undefined;

  onSettled(() => {
    if (frame && pile.fit({ width: frame.clientWidth, height: frame.clientHeight })) {
      // The new crew mount their own elements and faces before the film plays.
      plushes.length = 0;
      squashes.length = 0;
      faces.length = 0;
      setCrew(pile.crew);
      setPitSize(pile.pit);
      flush();
    }
    const film = pile.film();
    const rigs = pile.crew.flatMap((_, index): CrewRig[] => {
      const plush = plushes[index];
      const squash = squashes[index];
      return plush && squash ? [{ plush, squash }] : [];
    });
    // A test DOM has no Web Animations: the pile stays still, and a hop ends at once.
    if (pile.reduced || typeof Element.prototype.animate !== "function") {
      showRest(film, rigs);
      setPlayer({ hopOut: () => ({ delay: 0, length: 0 }), stop: () => {} });
      return;
    }
    const playing = playFilm(film, rigs, props.start, (index, face) => faces[index]?.(face));
    setPlayer(playing);
    return () => playing.stop();
  });

  createEffect(
    () => [props.hop, player(), props.onHop] as const,
    ([hop, playing, onHop]) => {
      if (hop && playing) onHop?.(playing.hopOut());
    },
  );

  return (
    <div
      ref={(element) => {
        frame = element;
      }}
      class="app-loading-pit-frame"
      aria-hidden="true"
    >
      <div
        class="app-loading-pit"
        style={{ width: `${pitSize().width}px`, height: `${pitSize().height}px`, scale: `${pitSize().unit}` }}
      >
        <For each={crew()}>
          {(member, position) => {
            // A crew never changes: a new crew mounts new elements, so each plush keeps its index.
            const index = untrack(position);
            const [face, setFace] = createSignal(pile.startFaces[index]);
            faces[index] = (next) => setFace(next);
            const crewState = () => face()?.state ?? "idle";
            const expression = () => {
              const current = face();
              return current ? crewExpression(member, current) : (restFace(member) ?? "neutre");
            };
            return (
              <div
                ref={(element) => {
                  plushes[index] = element;
                }}
                class="app-loading-plush"
                style={{
                  width: `${member.size}px`,
                  height: `${member.size}px`,
                  "transform-origin": `50% ${member.cy * 100}%`,
                }}
              >
                <div
                  ref={(element) => {
                    squashes[index] = element;
                  }}
                  class="app-loading-squash"
                  style={{ "transform-origin": `50% ${(member.cy + member.h / 2) * 100}%` }}
                >
                  <PlushBot
                    character={member.character}
                    state={crewState()}
                    expression={expression()}
                    size={member.size}
                    initialPhase={index * 0.7}
                    autoPause={false}
                    paused={true}
                    ariaLabel=""
                  />
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
