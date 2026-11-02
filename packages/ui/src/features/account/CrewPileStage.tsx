import type { BotExpression, ExpressionId } from "@norbert_bodziony/bloub";
import { PLUSH_CHARACTER_BY_ID, PlushBot } from "@norbert_bodziony/bloub/plush";
import { createSignal, For, onSettled, untrack } from "solid-js";
import { PlushMascot, type PlushMascotFace } from "../../plush-loader";
import { clamp } from "../../utils";
import { CREW_PIT, type CrewFace, type CrewMember, type CrewPile } from "./crew-pile";

/**
 * The scale limits of the pit, and the free room in pixels at the sides and above and below the
 * stage. The stage also holds the text, the detail and the actions under the pit, which are measured.
 */
const PIT_FIT = { maxScale: 1.2, minScale: 0.45, sideRoom: 32, edgeRoom: 152 } as const;

/** The face of a crew plush at rest: its character's own face, as PlushBot shows without an expression. */
function restFace(member: CrewMember): BotExpression | undefined {
  return member.character ? PLUSH_CHARACTER_BY_ID.get(member.character)?.face : undefined;
}

/**
 * The neutral face of a crew plush, turned to look at a point `dx`, `dy` pixels away (y down). The
 * gaze is absolute: bloub's rest gaze already looks up and to the right, so an offset hardly shows.
 */
function faceToward(member: CrewMember, dx: number, dy: number): BotExpression | ExpressionId {
  const neutral = restFace(member);
  if (!neutral) return "neutre";
  const distance = Math.hypot(dx, dy) || 1;
  return {
    ...neutral,
    gaze: {
      yaw: clamp((dx / distance) * 34, -32, 32),
      pitch: clamp((-dy / distance) * 34, -8, 30),
      roll: clamp((-dx / distance) * 8, -8, 8),
    },
  };
}

function crewExpression(member: CrewMember, face: CrewFace): BotExpression | ExpressionId {
  if (face.happy) return "heureux";
  if (face.look) return faceToward(member, face.look.dx, face.look.dy);
  return restFace(member) ?? "neutre";
}

function leadFace(face: CrewFace): PlushMascotFace {
  return face.happy ? "happy" : face.state;
}

export interface CrewPileStageProps {
  pile: CrewPile;
  /** Called on each frame while the screen is shown. The owner of the pile moves it here. */
  onFrame: (seconds: number) => void;
}

/**
 * Draws a crew pile. The pile sets each transform on each frame; the faces are signals, so a plush
 * updates only when its face changes. The pit scales to the window, and the pointer can grab any
 * plush and throw it.
 */
export function CrewPileStage(props: CrewPileStageProps) {
  const pile = props.pile;
  const plushes: (HTMLElement | undefined)[] = [];
  const squashes: (HTMLElement | undefined)[] = [];
  const faces = pile.bodies.map((body) => createSignal(body.face, { equals: (a, b) => a.version === b.version }));
  const [scale, setScale] = createSignal(1);
  let frame: HTMLDivElement | undefined;
  let pit: HTMLDivElement | undefined;

  function draw(): void {
    const poses = pile.poses();
    poses.forEach((pose, index) => {
      const plush = plushes[index];
      const squash = squashes[index];
      if (!plush || !squash) return;
      plush.style.visibility = pose.visible ? "visible" : "hidden";
      plush.style.transform = `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.tilt}rad) scale(${pose.scale})`;
      squash.style.transform = `scale(${pose.squashX}, ${pose.squashY})`;
    });
    pile.bodies.forEach((body, index) => {
      faces[index]?.[1](body.face);
    });
  }

  /** A pointer point in pit pixels: the pit is scaled to the window. */
  function pitPoint(event: PointerEvent): { x: number; y: number } | undefined {
    if (!pit) return undefined;
    const rect = pit.getBoundingClientRect();
    const ratio = rect.width / CREW_PIT.width;
    if (ratio <= 0) return undefined;
    return { x: (event.clientX - rect.left) / ratio, y: (event.clientY - rect.top) / ratio };
  }

  function grab(index: number, event: PointerEvent): void {
    const point = pitPoint(event);
    if (!point || !pile.grab(index, point.x, point.y, event.timeStamp / 1000)) return;
    event.preventDefault();
    if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: PointerEvent): void {
    const point = pitPoint(event);
    if (point) pile.drag(point.x, point.y, event.timeStamp / 1000);
  }

  onSettled(() => {
    const stage = frame?.parentElement;
    const room = stage?.closest<HTMLElement>(".app-loading");
    const fitPit = () => {
      if (!frame || !stage || !room) return;
      // The text, detail and actions under the pit do not change with its scale.
      const below = stage.offsetHeight - frame.offsetHeight;
      const width = (room.clientWidth - PIT_FIT.sideRoom) / CREW_PIT.width;
      const height = (room.clientHeight - below - PIT_FIT.edgeRoom) / CREW_PIT.height;
      setScale(clamp(Math.min(width, height), PIT_FIT.minScale, PIT_FIT.maxScale));
    };
    fitPit();
    const observer = new ResizeObserver(fitPit);
    if (room && stage) {
      observer.observe(room);
      observer.observe(stage);
    }
    draw();
    let request = 0;
    let last = -1;
    const tick = (now: number) => {
      request = requestAnimationFrame(tick);
      const seconds = last < 0 ? 0 : (now - last) / 1000;
      last = now;
      props.onFrame(seconds);
      draw();
    };
    if (!pile.reduced) request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      observer.disconnect();
    };
  });

  return (
    <div
      ref={(element) => {
        frame = element;
      }}
      class="app-loading-pit-frame"
      style={{ width: `${CREW_PIT.width * scale()}px`, height: `${CREW_PIT.height * scale()}px` }}
      aria-hidden="true"
    >
      <div
        ref={(element) => {
          pit = element;
        }}
        class="app-loading-pit"
        style={{ width: `${CREW_PIT.width}px`, height: `${CREW_PIT.height}px`, scale: `${scale()}` }}
      >
        <For each={pile.crew}>
          {(member, position) => {
            // The crew of a pile never changes, so each plush keeps its index.
            const index = untrack(position);
            const face = () => faces[index]?.[0]() ?? pile.bodies[index]?.face;
            const crewState = () => face()?.state ?? "idle";
            const expression = () => {
              const current = face();
              return current ? crewExpression(member, current) : (restFace(member) ?? "neutre");
            };
            const mascotFace = () => {
              const current = face();
              return current ? leadFace(current) : "idle";
            };
            return (
              <div
                ref={(element) => {
                  plushes[index] = element;
                }}
                class="app-loading-plush"
                data-lead={member.lead ? "true" : undefined}
                onPointerDown={(event) => grab(index, event)}
                onPointerMove={drag}
                onPointerUp={(event) => pile.release(event.timeStamp / 1000)}
                onPointerCancel={() => pile.release()}
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
                  {member.character ? (
                    <PlushBot
                      character={member.character}
                      state={crewState()}
                      expression={expression()}
                      size={member.size}
                      initialPhase={index * 0.7}
                      autoPause={false}
                      paused={pile.reduced}
                      ariaLabel=""
                    />
                  ) : (
                    <PlushMascot face={mascotFace()} class="app-loading-lead" />
                  )}
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
