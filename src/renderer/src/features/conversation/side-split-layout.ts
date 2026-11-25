import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { createSignal } from "solid-js";

export const SIDE_SPLIT_MIN = 120;
export const SIDE_MAIN_GROUP_MIN = 160;

const SIDE_SPLIT_LAYOUT_STORAGE_KEY = "openbot:side-split-layout";

interface SideSplitLayout {
  areas: Readonly<Record<string, number>>;
  lower: number | null;
}

function isShare(value: unknown): value is number {
  return isNumber(value) && value > 0 && value < 1;
}

function decodeLayout(value: unknown): SideSplitLayout {
  if (!isDynamicRecord(value)) return { areas: {}, lower: null };
  const areas = isDynamicRecord(value.areas)
    ? Object.fromEntries(Object.entries(value.areas).filter((entry): entry is [string, number] => isShare(entry[1])))
    : {};
  return { areas, lower: isShare(value.lower) ? value.lower : null };
}

function readLayout(): SideSplitLayout {
  try {
    return decodeLayout(JSON.parse(window.localStorage.getItem(SIDE_SPLIT_LAYOUT_STORAGE_KEY) ?? "null"));
  } catch {
    return { areas: {}, lower: null };
  }
}

let latestLayout = readLayout();
const [layout, setLayout] = createSignal<SideSplitLayout>(latestLayout);

function updateLayout(next: SideSplitLayout): void {
  latestLayout = next;
  setLayout(next);
}

export function sideSplitShare(count: number): number | null {
  return layout().areas[String(count)] ?? null;
}

export function lowerSplitShare(): number | null {
  return layout().lower;
}

export function setSideSplitShare(count: number, share: number | null): void {
  const key = String(count);
  const areas = Object.fromEntries(Object.entries(latestLayout.areas).filter(([area]) => area !== key));
  updateLayout({ ...latestLayout, areas: share === null ? areas : { ...areas, [key]: share } });
}

export function setLowerSplitShare(share: number | null): void {
  updateLayout({ ...latestLayout, lower: share });
}

export function saveSideSplitLayout(): void {
  try {
    window.localStorage.setItem(SIDE_SPLIT_LAYOUT_STORAGE_KEY, JSON.stringify(latestLayout));
  } catch {}
}
