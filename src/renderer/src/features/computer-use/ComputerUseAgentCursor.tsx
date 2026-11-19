import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect } from "solid-js";
import { agentCursorPointAt, type CursorMove, type CursorPoint, planAgentCursorMove } from "./agent-cursor-motion";

export interface ComputerUseAgentCursorProps {
  x: number;
  y: number;
}

const translate = (point: CursorPoint) => `${point.x}px ${point.y}px`;

export function ComputerUseAgentCursor(props: ComputerUseAgentCursorProps) {
  let element: SVGSVGElement | undefined;
  let target: CursorPoint | null = null;
  let playing: { move: CursorMove; animation: Animation } | null = null;

  createEffect(
    () => ({ x: props.x, y: props.y }),
    (next) => {
      if (target && target.x === next.x && target.y === next.y) return;
      const from = playing ? agentCursorPointAt(playing.move, Number(playing.animation.currentTime ?? 0)) : target;
      playing?.animation.cancel();
      playing = null;
      target = next;
      if (!element || !from || !("animate" in element) || prefersReducedMotion()) return;
      const move = planAgentCursorMove(from, next);
      const duration = move[move.length - 1]?.t ?? 0;
      if (duration <= 0) return;
      const animation = element.animate(
        move.map((sample) => ({ translate: translate(sample), offset: sample.t / duration })),
        { duration },
      );
      playing = { move, animation };
      animation.onfinish = () => {
        if (playing?.animation === animation) playing = null;
      };
    },
  );

  return (
    <svg
      ref={element}
      class="computer-use-agent-cursor"
      style={{ translate: translate(props) }}
      viewBox="0 0 45 49"
      aria-hidden="true"
    >
      <path d="M0 0 L45 20 L27 31 L14 49 Z" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  );
}
