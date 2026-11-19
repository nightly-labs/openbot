import { AGENT_DOCK_LIMITS, type AgentDockInputRect } from "@openbot/contracts/ipc";

export function windowShape(
  parts: readonly { x: number; y: number; width: number; height: number }[],
): AgentDockInputRect[] {
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
