import { NO_BLUR_ATTRIBUTE, STILL_FACES_ATTRIBUTE } from "@openbot/ui/document-rendering";
import { createSignal } from "solid-js";

/** The effects that cost the most when a window is drawn on the CPU. Each one has a switch in Settings. */
export type MotionEffect = "backgroundBlur" | "movingFaces";

const MOTION_EFFECTS: readonly MotionEffect[] = ["backgroundBlur", "movingFaces"];

const STORAGE_KEYS = {
  backgroundBlur: "openbot:background-blur",
  movingFaces: "openbot:moving-faces",
} as const satisfies Record<MotionEffect, string>;

/** The root attribute that each effect sets when it is off. `packages/ui` reads them. */
const OFF_ATTRIBUTES = {
  backgroundBlur: NO_BLUR_ATTRIBUTE,
  movingFaces: STILL_FACES_ATTRIBUTE,
} as const satisfies Record<MotionEffect, string>;

/** A choice of the user. With no choice, the effect is on unless the window is drawn on the CPU. */
type MotionChoices = Record<MotionEffect, boolean | undefined>;

/**
 * Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the
 * guard. Each value is "on" or "off"; an absent key means "automatic".
 */
function readChoice(effect: MotionEffect): boolean | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEYS[effect]);
    return value === "on" ? true : value === "off" ? false : undefined;
  } catch {
    return undefined;
  }
}

function writeChoice(effect: MotionEffect, choice: boolean | undefined): void {
  try {
    if (choice === undefined) window.localStorage.removeItem(STORAGE_KEYS[effect]);
    else window.localStorage.setItem(STORAGE_KEYS[effect], choice ? "on" : "off");
  } catch {
    // Blocked or full storage keeps the choice for this page only.
  }
}

function readChoices(): MotionChoices {
  return { backgroundBlur: readChoice("backgroundBlur"), movingFaces: readChoice("movingFaces") };
}

// Plain values are the source for the root attributes: Solid gives a written signal to readers only
// after the next flush, and the attributes must change at once.
let drawsOnCpu = false;
let choices = readChoices();

function effectOn(effect: MotionEffect): boolean {
  return choices[effect] ?? !drawsOnCpu;
}

function snapshot(): Record<MotionEffect, boolean> {
  return { backgroundBlur: effectOn("backgroundBlur"), movingFaces: effectOn("movingFaces") };
}

const [shown, setShown] = createSignal(snapshot());

function apply(): void {
  const root = document.documentElement;
  for (const effect of MOTION_EFFECTS) root.toggleAttribute(OFF_ATTRIBUTES[effect], !effectOn(effect));
  setShown(snapshot());
}

function readStorageIntoChoices(event: StorageEvent): void {
  if (event.key !== null && !Object.values<string>(STORAGE_KEYS).includes(event.key)) return;
  choices = readChoices();
  apply();
}

if (typeof window !== "undefined") {
  // Before the first paint, so a saved choice holds from the start.
  apply();
  // Another window of this app or browser changed the setting. One registration per page:
  // addEventListener ignores the same listener twice, and HMR disposal removes it.
  window.addEventListener("storage", readStorageIntoChoices);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoChoices);
  });
}

/**
 * Tells the setting that this window is drawn on the CPU: the desktop asks the main process, and the
 * web client asks WebGL. Each effect with no choice of the user then turns off.
 */
export function setDrawsOnCpu(value: boolean): void {
  drawsOnCpu = value;
  apply();
}

/** Whether the effect is on now, for the switch in Settings. */
export function useMotionEffect(effect: MotionEffect): () => boolean {
  return () => shown()[effect];
}

/**
 * Turns an effect on or off on this device and browser. A choice that is the same as the automatic
 * one is not kept, so the effect follows the computer again, as on a new install.
 */
export function setMotionEffect(effect: MotionEffect, on: boolean): void {
  const choice = on === !drawsOnCpu ? undefined : on;
  choices = { ...choices, [effect]: choice };
  writeChoice(effect, choice);
  apply();
}
