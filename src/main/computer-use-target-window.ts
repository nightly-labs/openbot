import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { Rectangle } from "electron";
import type { ObservedAction } from "./cua-driver-action-tap";
import { HIGHLIGHT_OWNER_SHORT_ID } from "./cua-driver-daemon-client";

/** Below this a "window" is a tool palette or a shadow helper, not something an agent works in. */
const MINIMUM_TARGET_SIZE = 120;
/** The driver's own cursor overlay covers a whole display and must never be taken for a target. */
const DRIVER_OVERLAY_APP = "cua-driver";

/** One window as the driver reports it, in desktop points with a top-left origin. */
export interface DriverWindow {
  windowId: number;
  pid: number;
  appName: string;
  title: string;
  bounds: Rectangle;
  /** The driver's back-to-front order: the largest number is the window in front. */
  zIndex: number;
  onScreen: boolean;
  onCurrentSpace: boolean;
}

/** The window the rim is drawn around. */
export interface ComputerUseHighlightTarget {
  windowId: number;
  title: string;
  bounds: Rectangle;
  /**
   * The parts of that window other windows cover, in desktop points, as rectangles that never
   * overlap. The rim gives way there, because it is drawn on an overlay that floats over them all.
   */
  covered: Rectangle[];
}

/**
 * How long after its last action a session still counts as holding the desktop.
 *
 * The daemon keeps a lease alive for five minutes after the last call, which is far longer than the
 * rim should outlive the work. The rim is a claim about now, so it follows the last action closely.
 */
const LIVE_SESSION_IDLE_SECONDS = 15;

/**
 * How recently a session must have acted for a change of front window to count as the agent's.
 *
 * Front-to-back order moves for two reasons: the agent raised a window, or the user clicked one.
 * The driver reports no owner for the change, so the answer is timing. A window that comes forward
 * while the agent is between two actions is the agent's; one that comes forward seconds later is
 * the user, and the rim must not follow the user out of the window the agent works in.
 */
const AGENT_ACTION_SECONDS = 2;

/**
 * How long one request keeps saying where the agent works.
 *
 * An agent reads far more often than it acts, and a read names no window, so the answer has to
 * outlive the request that gave it. It must not outlive the work: a request from a quarter of an
 * hour ago points at an application the user may have closed since.
 */
export const COMPUTER_USE_ACTION_MAX_AGE_MS = 60_000;

/**
 * How long one point keeps the agent cursor on the screen.
 *
 * Much shorter than the window above, because the two say different things. A window is where the
 * work is and stays that for as long as the work does; a point is where one action landed, and a
 * cursor left on the last click of a minute ago says the agent is still there when it is not.
 */
export const COMPUTER_USE_CURSOR_MAX_AGE_MS = 15_000;

/** One live lease, with the time since the last action that lease asked for. */
export interface LiveSession {
  idleSeconds: number;
}

/**
 * The lease of an agent that holds the desktop now, or `null` when no agent does.
 *
 * OpenBot's own read is in the same list: its connection takes a lease of its own. Counting it
 * would make the question answer itself - the rim would be up for as long as the daemon runs - so
 * that lease is left out by its name and by the kind a command line reports. The busiest of the
 * rest wins, because the rim follows the agent that acts, not the one that stopped a moment ago.
 */
export function liveSession(payload: unknown): LiveSession | null {
  if (!isDynamicRecord(payload) || !Array.isArray(payload.sessions)) return null;
  let busiest: LiveSession | null = null;
  for (const entry of payload.sessions) {
    if (!isDynamicRecord(entry)) continue;
    if (entry.client_kind === "cli" || entry.owner_short_id === HIGHLIGHT_OWNER_SHORT_ID) continue;
    if (entry.state !== "active") continue;
    const idle = entry.idle_seconds;
    const idleSeconds = typeof idle === "number" ? idle : 0;
    if (idleSeconds > LIVE_SESSION_IDLE_SECONDS) continue;
    if (!busiest || idleSeconds < busiest.idleSeconds) busiest = { idleSeconds };
  }
  return busiest;
}

export interface TargetChoice {
  windows: unknown;
  session: LiveSession | null;
  /** What the agent last asked the daemon to do, from the tap, or `null` when it asked nothing. */
  action: ObservedAction | null;
  /** OpenBot's own process, whose windows are never the target. */
  ownPid: number;
  /** The window the rim is on now, which the choice holds on to while it can. */
  previous: ComputerUseHighlightTarget | null;
}

/**
 * The window the rim marks.
 *
 * The agent's own last request is the answer whenever it named a window or an application: it says
 * where the agent works even while the driver acts in the background and leaves the window behind
 * everything else.
 *
 * Without such a request - a browser tool names a tab, not a window - the front window is the only
 * evidence left. Front order also moves each time the user clicks, so the rim holds the window it
 * has and gives it up only when the agent itself acted in the last seconds, or when the window is
 * gone. Otherwise the rim would follow the user out of the work the moment they looked away.
 */
export function chooseTarget({
  windows,
  session,
  action,
  ownPid,
  previous,
}: TargetChoice): ComputerUseHighlightTarget | null {
  if (!session) return null;
  const visible = visibleWindows(windows, ownPid);
  const candidates = workableWindows(visible);
  const acted = actedWindow(candidates, action);
  if (acted) return asTarget(acted, visible);
  const held = previous ? candidates.find((window) => window.windowId === previous.windowId) : undefined;
  if (held && session.idleSeconds > AGENT_ACTION_SECONDS) return asTarget(held, visible);
  const front = frontWindow(candidates);
  if (!front) return held ? asTarget(held, visible) : null;
  return asTarget(front, visible);
}

/**
 * The window one request names: the exact window when it gave a window, and otherwise the front
 * window of the application it gave, which is the one an action without a window lands in.
 */
function actedWindow(candidates: readonly DriverWindow[], action: ObservedAction | null): DriverWindow | null {
  if (!action) return null;
  const exact = candidates.find((window) => window.windowId === action.windowId);
  if (exact) return exact;
  if (action.pid === null) return null;
  return frontWindow(candidates.filter((window) => window.pid === action.pid));
}

/**
 * The window in front, of those an agent could work in.
 *
 * Exported for the test: this is the rule the rim starts from, and the one a change of the driver's
 * window order would break first.
 */
export function frontmostTarget(payload: unknown, ownPid: number): ComputerUseHighlightTarget | null {
  const visible = visibleWindows(payload, ownPid);
  const front = frontWindow(workableWindows(visible));
  return front ? asTarget(front, visible) : null;
}

function asTarget(window: DriverWindow, visible: readonly DriverWindow[]): ComputerUseHighlightTarget {
  return {
    windowId: window.windowId,
    title: window.title || window.appName,
    bounds: window.bounds,
    covered: coveredAreas(window, visible),
  };
}

/**
 * The parts of one window that the windows in front of it cover.
 *
 * Every window counts, not only those an agent could work in: a palette, a sheet or a notification
 * hides the window under it just as well. OpenBot's own windows and the driver's cursor overlay are
 * already out of the list this reads, so the rim is never cut by the surface that draws it.
 *
 * The answer holds no two rectangles that overlap. One cut that is made twice is a cut that is
 * undone, which is what an even-odd rule does with two overlapping holes, so the rectangles are
 * broken into strips that meet edge to edge instead.
 */
export function coveredAreas(window: DriverWindow, visible: readonly DriverWindow[]): Rectangle[] {
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

/**
 * The same area as the rectangles given, in rectangles that only ever meet at an edge.
 *
 * Every left and right edge in the set cuts the area into vertical strips. Inside one strip each
 * rectangle either covers its whole width or none of it, so what is left to join is a set of
 * intervals on one line.
 */
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
  // `list_windows` documents the largest z index as the window in front, and the driver's own
  // `bring_to_front` reads the same end of the range.
  for (const window of candidates) if (!best || window.zIndex > best.zIndex) best = window;
  return best;
}

/**
 * Every window on screen that is not OpenBot's own and not the driver's full-screen cursor overlay.
 *
 * Both of those are drawn over the desktop by this feature itself, so either one would otherwise
 * be taken for the window an agent works in.
 */
function visibleWindows(payload: unknown, ownPid: number): DriverWindow[] {
  return readWindows(payload).filter(
    (window) => window.pid !== ownPid && window.appName !== DRIVER_OVERLAY_APP && window.onScreen,
  );
}

/** Of those, the windows an agent could work in: on this Space and big enough to hold work. */
function workableWindows(visible: readonly DriverWindow[]): DriverWindow[] {
  return visible.filter(
    (window) =>
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
    // A window with no place in the front-to-back order cannot be compared with the others, so it
    // is left out rather than given a place it does not have.
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
