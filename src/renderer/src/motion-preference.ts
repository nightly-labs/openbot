import { NO_BLUR_ATTRIBUTE, STILL_FACES_ATTRIBUTE } from "@openbot/ui/document-rendering";
import { createSignal } from "solid-js";

export type MotionEffect = "backgroundBlur" | "movingFaces";

const MOTION_EFFECTS: readonly MotionEffect[] = ["backgroundBlur", "movingFaces"];

const STORAGE_KEYS = {
  backgroundBlur: "openbot:background-blur",
  movingFaces: "openbot:moving-faces",
} as const satisfies Record<MotionEffect, string>;

const OFF_ATTRIBUTES = {
  backgroundBlur: NO_BLUR_ATTRIBUTE,
  movingFaces: STILL_FACES_ATTRIBUTE,
} as const satisfies Record<MotionEffect, string>;

type MotionChoices = Record<MotionEffect, boolean | undefined>;

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
  } catch {}
}

function readChoices(): MotionChoices {
  return { backgroundBlur: readChoice("backgroundBlur"), movingFaces: readChoice("movingFaces") };
}

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
  apply();
  window.addEventListener("storage", readStorageIntoChoices);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoChoices);
  });
}

export function setDrawsOnCpu(value: boolean): void {
  drawsOnCpu = value;
  apply();
}

export function useMotionEffect(effect: MotionEffect): () => boolean {
  return () => shown()[effect];
}

export function setMotionEffect(effect: MotionEffect, on: boolean): void {
  const choice = on === !drawsOnCpu ? undefined : on;
  choices = { ...choices, [effect]: choice };
  writeChoice(effect, choice);
  apply();
}
