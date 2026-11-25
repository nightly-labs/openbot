import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { Point, Rectangle } from "electron";
import type { ObservedAction, ObservedPointer } from "./cua-driver-action-tap";
import { HIGHLIGHT_OWNER_SHORT_ID } from "./cua-driver-daemon-client";

const MINIMUM_TARGET_SIZE = 120;
const DRIVER_OVERLAY_APP = "cua-driver";

interface DriverWindow {
  windowId: number;
  pid: number;
  appName: string;
  title: string;
  bounds: Rectangle;
  zIndex: number;
  onScreen: boolean;
  onCurrentSpace: boolean;
}

export interface ComputerUseHighlightTarget {
  windowId: number;
  title: string;
  bounds: Rectangle;
  covered: Rectangle[];
}

const LIVE_SESSION_IDLE_SECONDS = 60;

const AGENT_ACTION_SECONDS = 2;

export const COMPUTER_USE_ACTION_MAX_AGE_MS = 60_000;

export const COMPUTER_USE_CURSOR_MAX_AGE_MS = 15_000;

export interface LiveSession {
  idleSeconds: number;
}

export function liveSession(payload: unknown, maxIdleSeconds = LIVE_SESSION_IDLE_SECONDS): LiveSession | null {
  const limit = Math.min(maxIdleSeconds, LIVE_SESSION_IDLE_SECONDS);
  if (!isDynamicRecord(payload) || !Array.isArray(payload.sessions)) return null;
  let busiest: LiveSession | null = null;
  for (const entry of payload.sessions) {
    if (!isDynamicRecord(entry)) continue;
    if (entry.client_kind === "cli" || entry.owner_short_id === HIGHLIGHT_OWNER_SHORT_ID) continue;
    if (entry.state !== "active") continue;
    const idle = entry.idle_seconds;
    const idleSeconds = typeof idle === "number" ? idle : 0;
    if (idleSeconds > limit) continue;
    if (!busiest || idleSeconds < busiest.idleSeconds) busiest = { idleSeconds };
  }
  return busiest;
}

export interface TargetChoice {
  windows: unknown;
  session: LiveSession | null;
  action: ObservedAction | null;
  ownPid: number;
  ownCoveringWindowIds?: ReadonlySet<number>;
  previous: ComputerUseHighlightTarget | null;
  toDesktop?: (bounds: Rectangle) => Rectangle;
}

export function pointerOnDesktop(pointer: ObservedPointer, windows: unknown): Point | null {
  if (pointer.windowId === null || pointer.screenshotWidth === null) return { x: pointer.x, y: pointer.y };
  const window = readWindows(windows).find((entry) => entry.windowId === pointer.windowId);
  if (!window) return null;
  const scale = window.bounds.width / pointer.screenshotWidth;
  return { x: window.bounds.x + pointer.x * scale, y: window.bounds.y + pointer.y * scale };
}

export function chooseTarget({
  windows,
  session,
  action,
  ownPid,
  ownCoveringWindowIds,
  previous,
  toDesktop,
}: TargetChoice): ComputerUseHighlightTarget | null {
  if (!session) return null;
  const visible = visibleWindows(windows, ownPid, ownCoveringWindowIds, toDesktop);
  const candidates = workableWindows(visible, ownPid);
  const acted = actedWindow(candidates, action);
  if (acted) return asTarget(acted, visible);
  if (action) return null;
  const held = previous ? candidates.find((window) => window.windowId === previous.windowId) : undefined;
  if (held && session.idleSeconds > AGENT_ACTION_SECONDS) return asTarget(held, visible);
  const front = frontWindow(candidates);
  if (!front) return held ? asTarget(held, visible) : null;
  return asTarget(front, visible);
}

function actedWindow(candidates: readonly DriverWindow[], action: ObservedAction | null): DriverWindow | null {
  if (!action) return null;
  const exact = candidates.find((window) => window.windowId === action.windowId);
  if (exact) return exact;
  if (action.pid === null) return null;
  return frontWindow(candidates.filter((window) => window.pid === action.pid));
}

function asTarget(window: DriverWindow, visible: readonly DriverWindow[]): ComputerUseHighlightTarget {
  return {
    windowId: window.windowId,
    title: window.title || window.appName,
    bounds: window.bounds,
    covered: coveredAreas(window, visible),
  };
}

function coveredAreas(window: DriverWindow, visible: readonly DriverWindow[]): Rectangle[] {
  const covers: Rectangle[] = [];
  for (const other of visible) {
    if (other.windowId === window.windowId || other.zIndex <= window.zIndex) continue;
    const shared = intersection(other.bounds, window.bounds);
    if (shared) covers.push(shared);
  }
  return withoutOverlap(covers);
}

function intersection(left: Rectangle, right: Rectangle): Rectangle | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const width = Math.min(left.x + left.width, right.x + right.width) - x;
  const height = Math.min(left.y + left.height, right.y + right.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function withoutOverlap(rectangles: readonly Rectangle[]): Rectangle[] {
  if (rectangles.length < 2) return [...rectangles];
  const edges = [...new Set(rectangles.flatMap((rectangle) => [rectangle.x, rectangle.x + rectangle.width]))].sort(
    (left, right) => left - right,
  );
  const parts: Rectangle[] = [];
  for (let index = 0; index + 1 < edges.length; index += 1) {
    const left = edges[index];
    const right = edges[index + 1];
    if (left === undefined || right === undefined || right <= left) continue;
    const spans = rectangles
      .filter((rectangle) => rectangle.x <= left && rectangle.x + rectangle.width >= right)
      .map((rectangle) => ({ top: rectangle.y, bottom: rectangle.y + rectangle.height }))
      .sort((one, other) => one.top - other.top);
    let open: { top: number; bottom: number } | null = null;
    for (const span of spans) {
      if (open && span.top <= open.bottom) {
        open.bottom = Math.max(open.bottom, span.bottom);
        continue;
      }
      if (open) parts.push({ x: left, y: open.top, width: right - left, height: open.bottom - open.top });
      open = { ...span };
    }
    if (open) parts.push({ x: left, y: open.top, width: right - left, height: open.bottom - open.top });
  }
  return parts;
}

function frontWindow(candidates: readonly DriverWindow[]): DriverWindow | null {
  let best: DriverWindow | null = null;
  for (const window of candidates) if (!best || window.zIndex > best.zIndex) best = window;
  return best;
}

function visibleWindows(
  payload: unknown,
  ownPid: number,
  ownCoveringWindowIds: ReadonlySet<number> = new Set(),
  toDesktop?: (bounds: Rectangle) => Rectangle,
): DriverWindow[] {
  const visible = readWindows(payload).filter(
    (window) =>
      (window.pid !== ownPid || ownCoveringWindowIds.has(window.windowId)) &&
      window.appName !== DRIVER_OVERLAY_APP &&
      window.onScreen,
  );
  return toDesktop ? visible.map((window) => ({ ...window, bounds: toDesktop(window.bounds) })) : visible;
}

function workableWindows(visible: readonly DriverWindow[], ownPid: number): DriverWindow[] {
  return visible.filter(
    (window) =>
      window.pid !== ownPid &&
      window.onCurrentSpace &&
      window.bounds.width >= MINIMUM_TARGET_SIZE &&
      window.bounds.height >= MINIMUM_TARGET_SIZE,
  );
}

function readWindows(payload: unknown): DriverWindow[] {
  if (!isDynamicRecord(payload) || !Array.isArray(payload.windows)) return [];
  const windows: DriverWindow[] = [];
  for (const entry of payload.windows) {
    if (!isDynamicRecord(entry)) continue;
    const bounds = readBounds(entry.bounds);
    const windowId = entry.window_id;
    const pid = entry.pid;
    const zIndex = entry.z_index;
    if (!bounds || typeof windowId !== "number" || typeof pid !== "number" || typeof zIndex !== "number") continue;
    windows.push({
      windowId,
      pid,
      appName: typeof entry.app_name === "string" ? entry.app_name : "",
      title: typeof entry.title === "string" ? entry.title : "",
      bounds,
      zIndex,
      onScreen: entry.is_on_screen !== false,
      onCurrentSpace: entry.on_current_space !== false,
    });
  }
  return windows;
}

function readBounds(value: unknown): Rectangle | null {
  if (!isDynamicRecord(value)) return null;
  const record: DynamicRecord = value;
  const { x, y, width, height } = record;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
