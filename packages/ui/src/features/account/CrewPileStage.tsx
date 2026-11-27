import type { BotExpression, ExpressionId } from "@norbert_bodziony/bloub";
import { PLUSH_CHARACTER_BY_ID, PlushBot } from "@norbert_bodziony/bloub/plush";
import { createEffect, createSignal, For, onSettled, untrack } from "solid-js";
import type { CrewFace, CrewFilm, CrewMember, CrewPile } from "./crew-pile";

function restFace(member: CrewMember): BotExpression | undefined {
  return PLUSH_CHARACTER_BY_ID.get(member.character)?.face;
}

function crewExpression(member: CrewMember, face: CrewFace): BotExpression | ExpressionId {
  if (face.happy) return "heureux";
  return restFace(member) ?? "neutre";
}

interface CrewRig {
  plush: HTMLElement;
  squash: HTMLElement;
}

export interface CrewHop {
  delay: number;
  length: number;
}

interface CrewPlayer {
  hopOut: () => CrewHop;
  stop: () => void;
}

const INTRO_HOLD_S = 3600;

function heldKeyframes(keyframes: readonly Keyframe[], length: number, hold: number): Keyframe[] {
  const share = length / (length + hold);
  const last = keyframes.at(-1);
  const moving = keyframes.map((keyframe) => ({ ...keyframe, offset: (keyframe.offset ?? 1) * share }));
  return last ? [...moving, { ...last, offset: 1 }] : moving;
}

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

const BREATH_KEYFRAMES = 24;

function breathKeyframes(film: CrewFilm, index: number): Keyframe[] {
  const { amount, from, period, phases } = film.breathe;
  const first = (2 * Math.PI * from) / period + (phases[index] ?? 0);
  return Array.from({ length: BREATH_KEYFRAMES + 1 }, (_, step) => {
    const breath = amount * Math.sin(first + (2 * Math.PI * step) / BREATH_KEYFRAMES);
    return { scale: `${(1 - breath / 2).toFixed(4)} ${(1 + breath).toFixed(4)}` };
  });
}

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
      for (const animation of [...intro.map((track) => track.animation), ...breaths, ...exit]) animation.cancel();
    },
  };
}

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
  start: number;
  hop?: boolean;
  onHop?: (hop: CrewHop) => void;
}

export function CrewPileStage(props: CrewPileStageProps) {
  const pile = props.pile;
  const plushes: (HTMLElement | undefined)[] = [];
  const squashes: (HTMLElement | undefined)[] = [];
  const faces: ((face: CrewFace) => void)[] = [];
  const [crew, setCrew] = createSignal(pile.crew);
  const [pitSize, setPitSize] = createSignal(pile.pit);
  const [player, setPlayer] = createSignal<CrewPlayer>();
  const [room, setRoom] = createSignal<{ width: number; height: number }>();
  const pitScale = () => {
    const pit = pitSize();
    const current = room();
    if (!current) return pit.unit;
    return Math.max(pit.unit, current.width / pit.width, current.height / pit.height);
  };
  let frame: HTMLDivElement | undefined;

  onSettled(() => {
    if (!frame || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRoom({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  });

  const [film, setFilm] = createSignal<CrewFilm>();

  onSettled(() => {
    if (frame && pile.fit({ width: frame.clientWidth, height: frame.clientHeight })) {
      plushes.length = 0;
      squashes.length = 0;
      faces.length = 0;
      setCrew(pile.crew);
      setPitSize(pile.pit);
    }
    setFilm(pile.film());
  });

  createEffect(film, (recorded) => {
    if (!recorded) return;
    const rigs = pile.crew.flatMap((_, index): CrewRig[] => {
      const plush = plushes[index];
      const squash = squashes[index];
      return plush && squash ? [{ plush, squash }] : [];
    });
    if (pile.reduced || typeof Element.prototype.animate !== "function") {
      showRest(recorded, rigs);
      setPlayer({ hopOut: () => ({ delay: 0, length: 0 }), stop: () => {} });
      return;
    }
    const playing = playFilm(recorded, rigs, props.start, (index, face) => faces[index]?.(face));
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
        style={{ width: `${pitSize().width}px`, height: `${pitSize().height}px`, scale: `${pitScale()}` }}
      >
        <For each={crew()}>
          {(member, position) => {
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
