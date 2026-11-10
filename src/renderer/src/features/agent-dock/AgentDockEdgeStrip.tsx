import type { AgentDockEdge } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { agentDockBody } from "@openbot/ui/features/agent-dock/AgentDock";
import { useText } from "@openbot/ui/text";
import { createEffect, onSettled } from "solid-js";

/** The width of the strip at rest. Linux takes the pointer only in this width at the edge. */
export const AGENT_DOCK_STRIP_WIDTH = 6;
/** The height of the strip at rest, as a part of the dock height. On Linux, only this part takes the pointer. */
export const AGENT_DOCK_STRIP_REST = 0.35;
/** The distance from the strip where it starts to grow toward the pointer. */
const STRIP_FEEL = 160;
/** The distance from the strip where the dock comes out. */
const STRIP_REVEAL = 28;
/**
 * The rest between two waves. A wave draws the dock window in each frame, and nothing moves in the rest.
 * After the first waves the rest is longer, so a question that waits a long time costs frames for only a
 * small part of the time.
 */
const WAVE_REST_MS = 12_000;
const WAVE_LATER_REST_MS = 30_000;
const WAVES_BEFORE_LATER_REST = 3;

/**
 * A thin strip at the screen edge while the dock is in the edge. It grows toward the shape of the dock as
 * the pointer comes near, and the dock comes out over it when the pointer is close. While an agent asks
 * something, a wash front in the colors of the theme change goes up through the strip from time to time.
 *
 * The strip reads the pointer at most one time in each frame and writes only a change. It reads the dock
 * body only when the body changes size, so a pointer frame causes no layout. The wave moves only
 * `translate` on one layer, and stops between the waves.
 */
export function AgentDockEdgeStrip(props: {
  side: AgentDockEdge;
  /** The dock is in the edge. */
  shown: boolean;
  /** An agent asks you something. */
  asks: boolean;
  /** The pointer comes close to the strip, or goes away. Called only on a change. */
  onNearChange: (near: boolean) => void;
  onShow: () => void;
}) {
  const { t } = useText();
  let strip: HTMLButtonElement | undefined;

  /* A question while the dock is in: a wave, a rest, and again, until the question ends. */
  createEffect(
    () => props.shown && props.asks,
    (active) => {
      const element = strip;
      if (!active || !element) return;
      let rest: ReturnType<typeof setTimeout> | undefined;
      let waves = 0;
      const start = () => element.setAttribute("data-wave", "");
      // With reduced motion the wave has no animation, so this never comes and the wash stays still.
      const onEnd = (event: AnimationEvent) => {
        if (event.pseudoElement !== "::after") return;
        element.removeAttribute("data-wave");
        waves += 1;
        rest = setTimeout(start, waves < WAVES_BEFORE_LATER_REST ? WAVE_REST_MS : WAVE_LATER_REST_MS);
      };
      element.addEventListener("animationend", onEnd);
      start();
      return () => {
        clearTimeout(rest);
        element.removeEventListener("animationend", onEnd);
        element.removeAttribute("data-wave");
      };
    },
  );

  onSettled(() => {
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    let near = false;
    /** The dock body box. The dock moves only sideways into the edge, so its top and bottom are where the strip is. */
    let box: DOMRect | undefined;
    /** The custom properties as last written, so that a frame writes only a change. */
    const written = new Map<string, string>();

    const setNear = (value: boolean) => {
      if (near === value) return;
      near = value;
      props.onNearChange(value);
    };
    const write = (name: string, value: string) => {
      if (written.get(name) === value) return;
      written.set(name, value);
      strip?.style.setProperty(name, value);
    };

    const update = () => {
      frame = 0;
      if (box) write("--agent-dock-strip-height", `${Math.round(box.height)}px`);
      if (!box || !pointer) {
        setNear(false);
        write("--agent-dock-strip-near", "0");
        return;
      }
      const dx = props.side === "left" ? pointer.x : window.innerWidth - pointer.x;
      const dy = Math.max(0, box.top - pointer.y, pointer.y - box.bottom);
      const distance = Math.hypot(dx, dy);
      setNear(distance <= STRIP_REVEAL);
      const grown = Math.min(1, Math.max(0, (STRIP_FEEL - distance) / (STRIP_FEEL - STRIP_REVEAL)));
      write("--agent-dock-strip-near", props.shown ? grown.toFixed(2) : "0");
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    const onMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onLeave = () => {
      pointer = null;
      schedule();
    };
    // The dock body changes size when an agent is added or removed, and its top changes with its size. The
    // observer calls after the layout, so the read here causes no layout of its own.
    const body = agentDockBody();
    const measure = () => {
      box = body?.getBoundingClientRect();
      schedule();
    };
    const size = new ResizeObserver(measure);
    if (body) size.observe(body);
    measure();

    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    // The dock is centred in the window.
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      setNear(false);
    };
  });

  return (
    <Button
      ref={strip}
      type="button"
      variant="ghost"
      class="agent-dock-strip"
      style={{
        "--agent-dock-strip-width": `${AGENT_DOCK_STRIP_WIDTH}px`,
        "--agent-dock-strip-rest": String(AGENT_DOCK_STRIP_REST),
      }}
      data-side={props.side}
      data-shown={props.shown ? "" : undefined}
      data-asks={props.asks ? "" : undefined}
      aria-label={props.asks ? t("agent.dock.strip.asks") : t("agent.dock.strip.show")}
      aria-hidden={props.shown ? undefined : "true"}
      tabindex={props.shown ? 0 : -1}
      onClick={() => props.onShow()}
    />
  );
}
