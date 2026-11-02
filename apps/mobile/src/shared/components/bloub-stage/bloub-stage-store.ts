/**
 * What the stage shows. One lilac block covers the screen, or its lower edge stops at `bottom` as a
 * header, or it fades away so a camera below it shows. The eyes always stay on the stage.
 */
type BloubShape = { kind: "cover" } | { kind: "header"; bottom: number } | { kind: "clear" };

/**
 * How the eyes behave. `think` looks around while the app works; `frame` and `found` turn the
 * eyes into the corners of a scanner frame.
 */
export type BloubMood = "idle" | "think" | "down" | "sad" | "happy" | "frame" | "found";

interface BloubCaption {
  /** A title under the eyes. Without one, the text is a status line at the bottom of the screen. */
  title?: string;
  text: string;
}

interface BloubBackAction {
  icon: "back" | "close";
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export interface BloubStageRequest {
  shape: BloubShape;
  mood: BloubMood;
  /** Shows only on a cover. */
  caption?: BloubCaption;
  back?: BloubBackAction;
  /**
   * The app loader: the splash and the waits that cover the app. In dark mode it dims the block,
   * so a full-screen block does not flash the user. Screens keep the bright block.
   */
  loader?: boolean;
}

/** A higher priority wins. In one priority, the request made last wins. */
export const BLOUB_PRIORITY = { screen: 1, loader: 2, splash: 3 } as const;

interface ActiveBloubRequest {
  id: string;
  request: BloubStageRequest;
}

interface Entry {
  id: string;
  priority: number;
  order: number;
  value: ActiveBloubRequest;
}

// A screen that leaves often hands the stage to the next screen in a later commit, such as the
// sign-in screen to the app's loader. The stage waits this long before it leaves.
const LINGER_MS = 220;

function sameShape(a: BloubShape, b: BloubShape): boolean {
  return a.kind === b.kind && (a.kind !== "header" || b.kind !== "header" || a.bottom === b.bottom);
}

/** The same request, apart from callbacks. A callback changes on every render of its screen. */
function sameRequest(a: BloubStageRequest, b: BloubStageRequest): boolean {
  return (
    sameShape(a.shape, b.shape) &&
    a.mood === b.mood &&
    Boolean(a.loader) === Boolean(b.loader) &&
    a.caption?.title === b.caption?.title &&
    a.caption?.text === b.caption?.text &&
    Boolean(a.caption) === Boolean(b.caption) &&
    a.back?.icon === b.back?.icon &&
    a.back?.label === b.back?.label &&
    a.back?.disabled === b.back?.disabled &&
    Boolean(a.back) === Boolean(b.back)
  );
}

export interface BloubStageStore {
  set: (id: string, priority: number, request: BloubStageRequest) => void;
  remove: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
  active: () => ActiveBloubRequest | null;
}

/** Requests from screens. The stage shows one at a time. */
export function createBloubStageStore(): BloubStageStore {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let order = 0;
  let active: ActiveBloubRequest | null = null;
  let linger: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: ActiveBloubRequest | null) => {
    if (next === active) return;
    active = next;
    for (const listener of listeners) listener();
  };

  const update = () => {
    let best: Entry | null = null;
    for (const entry of entries.values()) {
      if (!best || entry.priority > best.priority || (entry.priority === best.priority && entry.order > best.order))
        best = entry;
    }
    if (best) {
      if (linger) clearTimeout(linger);
      linger = null;
      publish(best.value);
      return;
    }
    if (!active || linger) return;
    linger = setTimeout(() => {
      linger = null;
      if (entries.size === 0) publish(null);
    }, LINGER_MS);
  };

  return {
    set(id, priority, request) {
      const current = entries.get(id);
      if (current && current.priority === priority && sameRequest(current.value.request, request)) {
        // Keep the shown object, so nothing renders again; the next press reads the new callback.
        if (current.value.request.back && request.back) current.value.request.back.onPress = request.back.onPress;
        return;
      }
      entries.set(id, { id, priority, order: current?.order ?? ++order, value: { id, request } });
      update();
    },
    remove(id) {
      if (entries.delete(id)) update();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    active: () => active,
  };
}
