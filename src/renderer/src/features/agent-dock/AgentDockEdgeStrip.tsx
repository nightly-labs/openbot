import type { AgentDockEdge } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { agentDockBody } from "@openbot/ui/features/agent-dock/AgentDock";
import { useText } from "@openbot/ui/text";
import { createEffect, onSettled } from "solid-js";

export const AGENT_DOCK_STRIP_WIDTH = 6;
export const AGENT_DOCK_STRIP_REST = 0.35;
const AGENT_DOCK_STRIP_FEEL = 160;
const STRIP_REVEAL = 28;
const WAVE_REST_MS = 12_000;
const WAVE_LATER_REST_MS = 30_000;
const WAVES_BEFORE_LATER_REST = 3;

export function AgentDockEdgeStrip(props: {
  side: AgentDockEdge;
  shown: boolean;
  asks: boolean;
  onNearChange: (near: boolean) => void;
  onShow: () => void;
}) {
  const { t } = useText();
  let strip: HTMLButtonElement | undefined;

  createEffect(
    () => props.shown && props.asks,
    (active) => {
      const element = strip;
      if (!active || !element) return;
      let rest: ReturnType<typeof setTimeout> | undefined;
      let waves = 0;
      const start = () => element.setAttribute("data-wave", "");
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
    let box: DOMRect | undefined;
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
      const grown = Math.min(
        1,
        Math.max(0, (AGENT_DOCK_STRIP_FEEL - distance) / (AGENT_DOCK_STRIP_FEEL - STRIP_REVEAL)),
      );
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
