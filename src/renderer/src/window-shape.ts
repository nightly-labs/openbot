import {
  AGENT_DOCK_LIMITS,
  type AgentDockEdge,
  type AgentDockExtent,
  type AgentDockInputRect,
} from "@openbot/contracts/ipc";

const EXTENT_MARGIN = 16;

interface ShapePart {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function windowShape(parts: readonly ShapePart[]): AgentDockInputRect[] {
  const shape: AgentDockInputRect[] = [];
  for (const part of parts) {
    const left = Math.max(0, Math.floor(part.x));
    const top = Math.max(0, Math.floor(part.y));
    const right = Math.min(window.innerWidth, Math.ceil(part.x + part.width));
    const bottom = Math.min(window.innerHeight, Math.ceil(part.y + part.height));
    if (right > left && bottom > top) shape.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return shape.slice(0, AGENT_DOCK_LIMITS.inputRects);
}

export function windowExtent(parts: readonly ShapePart[], edge: AgentDockEdge): AgentDockExtent | null {
  if (parts.length === 0) return null;
  const left = Math.min(...parts.map((part) => part.x));
  const right = Math.max(...parts.map((part) => part.x + part.width));
  const center = window.innerHeight / 2;
  const top = Math.min(...parts.map((part) => part.y));
  const bottom = Math.max(...parts.map((part) => part.y + part.height));
  const reach = (distance: number) =>
    Math.min(AGENT_DOCK_LIMITS.inputExtent, Math.max(0, Math.ceil(distance + EXTENT_MARGIN)));
  return {
    inward: reach(edge === "left" ? right : window.innerWidth - left),
    above: reach(center - top),
    below: reach(bottom - center),
  };
}
