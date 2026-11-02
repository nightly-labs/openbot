import { type Spring, springKeyframes, springProgress } from "@openbot/ui/spring-motion";
import { clamp, mix, motionDuration, prefersReducedMotion } from "@openbot/ui/utils";

/** The send motion: a spring with no visible bounce. It starts at rest, so a motion does not jump at its first frame. */
const SEND_SPRING: Spring = { response: 0.43, dampingFraction: 0.78 };

/**
 * The island springs, as the product island and the voice morph use them: the island opens with a small
 * overshoot and closes with none. The content comes and goes on its own, shorter spring.
 */
const ISLAND_OPEN: Spring = { response: 0.5, dampingFraction: 0.8 };
const ISLAND_CLOSE: Spring = { response: 0.45, dampingFraction: 1 };
const ISLAND_CONTENT: Spring = { response: 0.34, dampingFraction: 0.88 };

/** With reduced motion, the island does not change size, and its content changes with this short fade. */
const ISLAND_FADE_MS = 150;

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Where `spring` is at `time`, from 0 to 1 of a motion that lasts `length` seconds. It ends at exactly 1. */
function springAt(time: number, spring: Spring, length: number): number {
  if (time >= 1) return 1;
  return springProgress(time * length, spring) / springProgress(length, spring);
}

/** The island open spring as a `linear()` easing, for the CSS transition of the queue. */
export const ISLAND_EASING = `linear(${Array.from({ length: 33 }, (_, index) => springAt(index / 32, ISLAND_OPEN, ISLAND_OPEN.response).toFixed(4)).join(", ")})`;

/** The length of one spring in milliseconds. */
function springMs(spring: Spring): number {
  return spring.response * 1000;
}

/** How long the island takes to open, for the CSS transition of the queue. */
export const ISLAND_DURATION_MS = springMs(ISLAND_OPEN);

function px(value: number): string {
  return `${value}px`;
}

/** The text box of an element's content, or of the element when it has no text. */
export function textRect(element: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 ? rect : element.getBoundingClientRect();
}

/**
 * A copy of an element for a motion: no ids, no inline style, no focus, no typed values (a code or a
 * password), and hidden from assistive technology.
 */
function inertCopy(element: Element): HTMLElement | undefined {
  const copy = element.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return undefined;
  for (const node of [copy, ...copy.querySelectorAll("[id]")]) node.removeAttribute("id");
  for (const field of copy.querySelectorAll("input, textarea")) {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = "";
  }
  copy.removeAttribute("style");
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  return copy;
}

/** How long the field, or a queue row, takes to change into the island. */
export function morphDuration(): number {
  return motionDuration("--openbot-duration-overlay", 240) * 2.25;
}

/** The corner radius of an element in pixels; a pill radius is half of its height. */
function cornerRadius(element: Element, rect: DOMRect): number {
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return Math.min(radius, rect.height / 2);
}

/**
 * Where the change into the island starts: the box of the field or of a queue row, its corners, and its
 * text. Measure it before the message leaves, because a sent row leaves the page. The field stays, so the copy
 * comes out from under it; a row goes, so the copy takes its place at once.
 */
export interface MorphSource {
  box: DOMRect;
  radius: number;
  size: number;
  words: DOMRect;
  stays: boolean;
}

export function morphSource(box: Element, text: Element, stays: boolean, words = textRect(text)): MorphSource {
  const rect = box.getBoundingClientRect();
  return {
    box: rect,
    radius: cornerRadius(box, rect),
    size: Number.parseFloat(getComputedStyle(text).fontSize) || 14,
    words,
    stays,
  };
}

/**
 * Changes the field, or a queue row, into the island. A glass copy comes out from under the source and takes
 * the size and shape of the island, while the sent text moves to the place of the step, gets smaller and fades.
 * The content of the island fades in on the copy, so that at the end the real island takes the place of the
 * copy with no visible change. The copy follows the island on each frame, because the queue closes and moves
 * it, and the island changes size, while the copy is on its way. When the island is already in view, the copy
 * has no content and goes into the island, which shows the new step itself.
 */
export function morphInto(
  layer: HTMLElement,
  text: string,
  source: MorphSource,
  target: { box: HTMLElement; text: Element },
  merge = false,
) {
  if (prefersReducedMotion()) return;
  const first = target.box.getBoundingClientRect();
  const size = Number.parseFloat(getComputedStyle(target.text).fontSize) || source.size;
  const duration = morphDuration();
  const length = duration / 1000;
  const shell = document.createElement("div");
  shell.className = "browser-dock-morph";
  shell.setAttribute("aria-hidden", "true");
  // The face is the island without its glass, so the copy shows the same step, spinner and button.
  const face = merge ? undefined : inertCopy(target.box);
  if (face) {
    Object.assign(face.style, { width: px(first.width), height: px(first.height) });
    shell.append(face);
  }
  const label = document.createElement("span");
  label.className = "browser-dock-morph-text";
  label.setAttribute("aria-hidden", "true");
  label.textContent = text;
  const words = source.words;
  Object.assign(label.style, {
    width: px(Math.max(words.width, 1)),
    lineHeight: px(words.height),
    fontSize: px(source.size),
  });
  layer.append(shell, label);
  if (face) target.box.style.visibility = "hidden";

  // The spinner of the copy turns with the spinner of the island, so it does not jump at the end.
  const spin = target.box.querySelector(".browser-dock-spin")?.getAnimations()[0];
  const faceSpin = face?.querySelector(".browser-dock-spin")?.getAnimations()[0];
  if (spin && faceSpin) faceSpin.startTime = spin.startTime;

  const fade = { duration, fill: "forwards" } as const;
  if (merge) {
    shell.animate(
      [{ opacity: source.stays ? 0 : 1 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
      fade,
    );
  } else if (source.stays) {
    shell.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1 }], fade);
  }
  face?.animate(
    [
      { opacity: 0, filter: "blur(4px)" },
      { opacity: 0, filter: "blur(4px)", offset: 0.3 },
      { opacity: 1, filter: "blur(0)", offset: 0.75 },
      { opacity: 1, filter: "blur(0)" },
    ],
    fade,
  );
  // The text is gone before the step shows, so the two never overlap.
  label.animate(
    [
      { opacity: 1, filter: "blur(0)" },
      { opacity: 1, filter: "blur(0)", offset: 0.15 },
      { opacity: 0, filter: "blur(3px)", offset: 0.45 },
      { opacity: 0, filter: "blur(3px)" },
    ],
    fade,
  );

  const from = source.box;
  const begin = performance.now();
  let frame = 0;
  const land = () => {
    cancelAnimationFrame(frame);
    if (face) target.box.style.visibility = "";
    shell.remove();
    label.remove();
  };
  const draw = (now: number) => {
    if (!target.box.isConnected || !layer.isConnected) return land();
    const time = Math.min((now - begin) / duration, 1);
    const progress = springAt(time, SEND_SPRING, length);
    const origin = layer.getBoundingClientRect();
    const to = target.box.getBoundingClientRect();
    const step = textRect(target.text);
    Object.assign(shell.style, {
      left: px(mix(from.left, to.left, progress) - origin.left),
      top: px(mix(from.top, to.top, progress) - origin.top),
      width: px(mix(from.width, to.width, progress)),
      height: px(mix(from.height, to.height, progress)),
      borderRadius: px(mix(source.radius, cornerRadius(target.box, to), progress)),
    });
    const x = mix(words.left, step.left, progress) - origin.left;
    const middle = mix(words.top + words.height / 2, step.top + step.height / 2, progress);
    const scale = mix(1, size / source.size, progress);
    label.style.transform = `translate(${x}px, ${middle - words.height / 2 - origin.top}px) scale(${scale})`;
    if (time < 1) frame = requestAnimationFrame(draw);
    else land();
  };
  draw(begin);
}

/**
 * Where the queue was before a new row changed it: the top edge that shows, and the top of each row. A queue
 * that still rises from the last send shows less than its box.
 */
export interface QueueLayout {
  edge: number;
  rows: Map<string, number>;
}

export function queueLayout(stack: HTMLElement, field: HTMLElement): QueueLayout {
  const rows = new Map<string, number>();
  for (const row of stack.querySelectorAll<HTMLElement>(".agent-queue-item")) {
    rows.set(row.dataset.queueDeliveryId ?? "", row.getBoundingClientRect().top);
  }
  const panel = stack.querySelector(".agent-queue-panel");
  if (!panel) return { edge: field.getBoundingClientRect().top, rows };
  const clipped = Number.parseFloat(/inset\(([-\d.]+)px/.exec(getComputedStyle(panel).clipPath)?.[1] ?? "") || 0;
  return { edge: panel.getBoundingClientRect().top + Math.max(clipped, 0), rows };
}

/** Stops the rise of each queue, so that the next send takes the clip over. */
const rising = new WeakMap<HTMLElement, () => void>();

/**
 * Moves a sent message from the field into its new queue row. The queue takes its new size at once, and a clip
 * hides the part that is still under the field, so the top edge of the queue, with its round corners, rises out
 * of the field on the send spring. The rows that were there rise with the edge. The sent text moves on the same
 * spring and takes the place of the row text. The icon and the buttons come in on the island content spring
 * while the text settles: first the icon, then each button.
 */
export function morphIntoRow(
  layer: HTMLElement,
  text: string,
  source: MorphSource,
  before: QueueLayout,
  row: { box: HTMLElement; text: HTMLElement },
) {
  const slot = row.box.closest<HTMLElement>(".agent-queue-slot");
  const panel = row.box.closest<HTMLElement>(".agent-queue-panel");
  if (prefersReducedMotion() || !slot || !panel) return;
  const duration = morphDuration();
  const length = duration / 1000;
  const along = (frame: (progress: number) => Keyframe): Keyframe[] =>
    Array.from({ length: 33 }, (_, index) => ({
      ...frame(springAt(index / 32, SEND_SPRING, length)),
      offset: index / 32,
    }));

  // The clip opens the queue, not the slot, so the slot takes its new size at once.
  slot.style.transition = "none";
  const box = panel.getBoundingClientRect();
  requestAnimationFrame(() => slot.style.removeProperty("transition"));
  const hidden = Math.max(before.edge - box.top, 0);
  const radius = cornerRadius(panel, box);
  const begin = performance.now();
  // The queue animates its own height when its list changes size. The clip opens it here, so this observer,
  // which comes after the one of the queue, stops that animation before the frame shows.
  const resizer = panel.querySelector(".agent-queue-panel-resize");
  const list = panel.querySelector(".agent-queue-panel-list");
  const settle = new ResizeObserver(() => {
    for (const animation of resizer?.getAnimations() ?? []) animation.cancel();
  });
  // The clip changes on each frame: Chromium does not clip the glass blur with a running clip-path animation.
  let clipFrame = 0;
  const stop = () => {
    cancelAnimationFrame(clipFrame);
    settle.disconnect();
    panel.style.removeProperty("clip-path");
    rising.delete(panel);
  };
  rising.get(panel)?.();
  rising.set(panel, stop);
  if (list) settle.observe(list);
  const rise = (now: number) => {
    const time = Math.min((now - begin) / duration, 1);
    if (time >= 1 || !panel.isConnected) return stop();
    panel.style.clipPath = `inset(${mix(hidden, 0, springAt(time, SEND_SPRING, length))}px 0 0 0 round ${radius}px)`;
    clipFrame = requestAnimationFrame(rise);
  };
  rise(begin);
  for (const other of panel.querySelectorAll<HTMLElement>(".agent-queue-item")) {
    const top = before.rows.get(other.dataset.queueDeliveryId ?? "");
    const shift = top === undefined ? 0 : top - other.getBoundingClientRect().top;
    if (shift) {
      other.animate(
        along((progress) => ({ transform: `translateY(${mix(shift, 0, progress)}px)` })),
        { duration, easing: "linear" },
      );
    }
  }

  const size = Number.parseFloat(getComputedStyle(row.text).fontSize) || source.size;
  const label = document.createElement("span");
  label.className = "browser-dock-morph-text";
  label.setAttribute("aria-hidden", "true");
  label.textContent = text;
  const words = source.words;
  Object.assign(label.style, { lineHeight: px(words.height), fontSize: px(source.size) });
  layer.append(label);
  row.box.dataset.arriving = "";
  // The shared enter motion of a row stops: its parts come in on their own.
  for (const animation of row.box.getAnimations()) {
    if (animation instanceof CSSAnimation) animation.cancel();
  }
  const parts = [
    ...row.box.querySelectorAll<HTMLElement>(":scope > :not(.agent-queue-message, .agent-queue-actions)"),
    ...row.box.querySelectorAll<HTMLElement>(".agent-queue-actions > *"),
  ];
  parts.forEach((part, index) => {
    const motion = index === 0 ? popIn : riseIn;
    contentIn(part, duration * (0.3 + 0.07 * index), motion);
  });

  let frame = 0;
  const land = () => {
    cancelAnimationFrame(frame);
    delete row.box.dataset.arriving;
    label.remove();
  };
  const draw = (now: number) => {
    if (!label.isConnected || !row.box.isConnected || !layer.isConnected) return land();
    const time = Math.min((now - begin) / duration, 1);
    const progress = springAt(time, SEND_SPRING, length);
    const origin = layer.getBoundingClientRect();
    // The box of the row text, not its words: a long message ends in an ellipsis there, and so does the copy.
    const step = row.text.getBoundingClientRect();
    const scale = mix(1, size / source.size, progress);
    const x = mix(words.left, step.left, progress) - origin.left;
    const middle = mix(words.top + words.height / 2, step.top + step.height / 2, progress);
    label.style.width = px(Math.max(mix(words.width, step.width, progress), 1) / scale);
    label.style.transform = `translate(${x}px, ${middle - words.height / 2 - origin.top}px) scale(${scale})`;
    if (time < 1) frame = requestAnimationFrame(draw);
    else land();
  };
  draw(begin);
}

/** A short spring press of an element, as a tap on the island: it gives a little and comes back. */
export function press(element: Element | undefined) {
  if (!element || prefersReducedMotion()) return;
  element.animate(
    springKeyframes(ISLAND_OPEN, (progress) => ({ transform: `scale(${mix(0.985, 1, progress)})` })),
    { duration: springMs(ISLAND_OPEN), easing: "linear" },
  );
}

/**
 * The parts of the step that roll to their new text when the step changes. The step stays at the start of
 * the island, and the button at its end.
 */
const ROLL_PARTS = [
  { selector: ".browser-dock-status", end: false },
  { selector: ".browser-dock-handoff", end: true },
] as const;

/** What the island showed before a change: its box and corners, and a copy of it that can leave on its own. */
export interface IslandSnapshot {
  mode: string | undefined;
  rect: DOMRect;
  radius: number;
  copy: HTMLElement;
  face: DOMRect | undefined;
  opacity: number;
  parts: { selector: string; end: boolean; rect: DOMRect; text: string }[];
}

/** The size and corners of the island, and how far down it is, at one end of a motion. */
interface IslandBox {
  width: number;
  height: number;
  radius: number;
  drop: number;
}

function islandFace(shell: Element): HTMLElement | null {
  return shell.querySelector<HTMLElement>(":scope > .browser-dock-island-face:not(.browser-dock-island-leaving)");
}

/** Measure the island before a change. A motion that is on its way gives its current size, so the next one continues from there. */
export function snapshotIsland(shell: HTMLElement): IslandSnapshot | undefined {
  const copy = inertCopy(shell);
  if (!copy) return undefined;
  for (const old of copy.querySelectorAll(".browser-dock-island-leaving")) old.remove();
  const rect = shell.getBoundingClientRect();
  const face = islandFace(shell);
  return {
    mode: shell.dataset.mode,
    rect,
    radius: cornerRadius(shell, rect),
    copy,
    face: face?.getBoundingClientRect(),
    opacity: face ? Number.parseFloat(getComputedStyle(face).opacity) : 1,
    parts: ROLL_PARTS.flatMap(({ selector, end }) => {
      const element = face?.querySelector(selector);
      return element ? [{ selector, end, rect: element.getBoundingClientRect(), text: element.textContent ?? "" }] : [];
    }),
  };
}

const boxOf = (rect: DOMRect, radius: number, drop = 0): IslandBox => ({
  width: rect.width,
  height: rect.height,
  radius,
  drop,
});

/** The small capsule that the island grows out of, under the top edge of the composer, and goes back into. */
function budBox(rect: DOMRect, drop: number): IslandBox {
  const height = Math.min(rect.height, 22);
  return { width: Math.min(rect.width, 64), height, radius: height / 2, drop: drop + height / 2 };
}

/** Takes the content out of the flow at its size, in the middle of the island, so it does not wrap while the island changes size. */
function pin(element: HTMLElement, rect: DOMRect) {
  Object.assign(element.style, {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: px(rect.width),
    height: px(rect.height),
    margin: "0",
    translate: "-50% -50%",
  });
}

function unpin(element: HTMLElement) {
  for (const name of ["position", "top", "left", "width", "height", "margin", "translate"]) {
    element.style.removeProperty(name);
  }
}

/** Makes a copy of old content leave the island: it does not take the pointer, and it is not in the flow. */
function leave(element: HTMLElement) {
  element.removeAttribute("style");
  element.classList.add("browser-dock-island-leaving");
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
}

function resize(shell: HTMLElement, from: IslandBox, to: IslandBox, spring: Spring): Animation {
  return shell.animate(
    springKeyframes(spring, (progress) => ({
      width: px(mix(from.width, to.width, progress)),
      height: px(Math.max(0, mix(from.height, to.height, progress))),
      borderRadius: px(Math.max(0, mix(from.radius, to.radius, progress))),
      transform: `translateY(${mix(from.drop, to.drop, progress)}px)`,
    })),
    { duration: springMs(spring), easing: "linear", fill: "forwards" },
  );
}

/** The old content leaves before the island reaches its new size: it fades, blurs and moves a little. */
function contentOut(element: HTMLElement, opacity: number, duration: number, motion: string) {
  return element.animate(
    [
      { opacity, filter: "blur(0px)", transform: "none" },
      { opacity: 0, filter: "blur(4px)", transform: motion },
    ],
    { duration, easing: EASE_OUT, fill: "forwards" },
  );
}

/** The new content comes in on its own spring, and is opaque before the spring ends. `motion` gets what is left of the way, from 1 to 0. */
function contentIn(element: HTMLElement, delay: number, motion: (rest: number) => string) {
  return element.animate(
    springKeyframes(ISLAND_CONTENT, (progress) => ({
      opacity: clamp(progress * 1.5, 0, 1),
      filter: `blur(${Math.max(0, 4 * (1 - progress))}px)`,
      transform: motion(1 - progress),
    })),
    { duration: springMs(ISLAND_CONTENT), delay, easing: "linear", fill: "backwards" },
  );
}

const growIn = (rest: number) => `scale(${1 - 0.04 * rest})`;
const rollIn = (rest: number) => `translateY(${50 * rest}%)`;
const popIn = (rest: number) => `scale(${1 - 0.4 * rest})`;
const riseIn = (rest: number) => `translateY(${4 * rest}px) scale(${1 - 0.1 * rest})`;

/** The island grows out of a small capsule under the top edge of the composer. */
function budIsland(shell: HTMLElement, drop: number) {
  const to = shell.getBoundingClientRect();
  const face = islandFace(shell);
  if (face) pin(face, face.getBoundingClientRect());
  // It comes out from under the composer, so it is under the composer until it is open.
  shell.dataset.budding = "";
  shell.style.overflow = "hidden";
  const duration = springMs(ISLAND_OPEN);
  const motion = resize(shell, budBox(to, drop), boxOf(to, cornerRadius(shell, to)), ISLAND_OPEN);
  const fade = shell.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }], { duration });
  const enter = face ? contentIn(face, duration * 0.3, growIn) : undefined;
  const end = () => {
    motion.cancel();
    fade.cancel();
    enter?.cancel();
    if (face) unpin(face);
    delete shell.dataset.budding;
    shell.style.removeProperty("overflow");
  };
  motion.addEventListener("finish", end);
  return end;
}

/**
 * The island changes into other content: a step into a reply or a code card, or back. It springs to its new
 * size and corners, the old content leaves first, and the new content comes in.
 */
function swapIsland(before: IslandSnapshot, shell: HTMLElement) {
  const to = shell.getBoundingClientRect();
  const grows = to.width * to.height >= before.rect.width * before.rect.height;
  const spring = grows ? ISLAND_OPEN : ISLAND_CLOSE;
  const duration = springMs(spring);
  const face = islandFace(shell);
  if (face) pin(face, face.getBoundingClientRect());
  const old = islandFace(before.copy);
  if (old && before.face) {
    leave(old);
    pin(old, before.face);
    shell.append(old);
    contentOut(old, before.opacity, duration * 0.35, "scale(0.96)");
  }
  shell.style.overflow = "hidden";
  const motion = resize(shell, boxOf(before.rect, before.radius), boxOf(to, cornerRadius(shell, to)), spring);
  const enter = face ? contentIn(face, duration * 0.3, growIn) : undefined;
  const end = () => {
    motion.cancel();
    enter?.cancel();
    old?.remove();
    if (face) unpin(face);
    shell.style.removeProperty("overflow");
  };
  motion.addEventListener("finish", end);
  return end;
}

/**
 * The step changes: the island springs to the width of the new text, the old text moves up and blurs out,
 * and the new text comes in from below. The button stays at the end of the island.
 */
function rollIsland(before: IslandSnapshot, shell: HTMLElement) {
  const to = shell.getBoundingClientRect();
  const spring = to.width >= before.rect.width ? ISLAND_OPEN : ISLAND_CLOSE;
  const edge = shell.clientLeft;
  const content = springMs(ISLAND_CONTENT);
  const leaving: HTMLElement[] = [];
  const entering: Animation[] = [];
  for (const part of before.parts) {
    const element = islandFace(shell)?.querySelector<HTMLElement>(part.selector);
    const old = before.copy.querySelector<HTMLElement>(part.selector);
    if (!element || !old || element.textContent === part.text) continue;
    leave(old);
    Object.assign(old.style, {
      position: "absolute",
      top: px(part.rect.top - before.rect.top - edge),
      width: px(part.rect.width),
      height: px(part.rect.height),
      margin: "0",
    });
    if (part.end) old.style.right = px(before.rect.right - part.rect.right - edge);
    else old.style.left = px(part.rect.left - before.rect.left - edge);
    shell.append(old);
    leaving.push(old);
    // The two texts roll together, so the island is never empty.
    contentOut(old, 1, content * 0.6, "translateY(-50%)");
    entering.push(contentIn(element, 0, rollIn));
  }
  shell.style.overflow = "hidden";
  const motion = resize(shell, boxOf(before.rect, before.radius), boxOf(to, cornerRadius(shell, to)), spring);
  const end = () => {
    motion.cancel();
    for (const animation of entering) animation.cancel();
    for (const old of leaving) old.remove();
    shell.style.removeProperty("overflow");
  };
  motion.addEventListener("finish", end);
  return end;
}

/** Puts the copy of an island that closes in the dock, at the place of the island, from the bottom of the dock. */
function placeGhost(dock: HTMLElement, before: IslandSnapshot): HTMLElement {
  const ghost = before.copy;
  ghost.classList.add("browser-dock-island-ghost");
  const box = dock.getBoundingClientRect();
  // The dock keeps its bottom edge when the island leaves it, so the copy keeps its place from the bottom.
  Object.assign(ghost.style, {
    left: px(before.rect.left + before.rect.width / 2 - box.left),
    bottom: px(box.bottom - before.rect.bottom),
    width: px(before.rect.width),
    height: px(before.rect.height),
  });
  dock.append(ghost);
  return ghost;
}

/**
 * The island closes: its content leaves, it contracts to a small capsule and sinks under the top edge of the
 * composer. A copy does the motion, because the island itself is gone. Nothing stops it: a new island can
 * open while it sinks.
 */
function sinkIsland(dock: HTMLElement, before: IslandSnapshot, drop: number) {
  const ghost = placeGhost(dock, before);
  const duration = springMs(ISLAND_CLOSE);
  const face = islandFace(ghost);
  if (face && before.face) {
    pin(face, before.face);
    contentOut(face, before.opacity, duration * 0.35, "scale(0.96)");
  }
  const motion = resize(ghost, boxOf(before.rect, before.radius), budBox(before.rect, drop), ISLAND_CLOSE);
  ghost.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration, fill: "forwards" });
  motion.addEventListener("finish", () => ghost.remove());
}

/**
 * Moves the island from what it showed (`before`) to what it shows now (`shell`), as the Dynamic Island
 * does: it opens out of the composer, changes size and content with a spring, and closes back into the
 * composer. Returns a function that ends the motion at once, so that the next change starts from where this
 * one is.
 */
export function playIsland(
  dock: HTMLElement,
  before: IslandSnapshot | undefined,
  shell: HTMLElement | undefined,
): (() => void) | undefined {
  const stack = dock.querySelector(".browser-dock-stack")?.getBoundingClientRect();
  if (prefersReducedMotion()) {
    if (shell && before?.mode !== shell.dataset.mode) {
      islandFace(shell)?.animate([{ opacity: 0 }, { opacity: 1 }], ISLAND_FADE_MS);
    }
    if (before && !shell) {
      const ghost = placeGhost(dock, before);
      ghost
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: ISLAND_FADE_MS, fill: "forwards" })
        .addEventListener("finish", () => ghost.remove());
    }
    return undefined;
  }
  if (before && !shell) {
    sinkIsland(dock, before, (stack?.top ?? before.rect.bottom) - before.rect.bottom);
    return undefined;
  }
  if (!shell) return undefined;
  if (!before) {
    const to = shell.getBoundingClientRect();
    return budIsland(shell, (stack?.top ?? to.bottom) - to.bottom);
  }
  if (before.mode === "activity" && shell.dataset.mode === "activity") return rollIsland(before, shell);
  return swapIsland(before, shell);
}
