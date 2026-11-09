import { createSignal } from "solid-js";

const INTERFACE_FONT_STORAGE_KEY = "openbot:interface-font";

/**
 * The font stack of the brand token. The chosen family goes in front of it, so a family that is
 * missing, or that has no glyph for a character, reads in the font that OpenBot ships with.
 */
const DEFAULT_INTERFACE_FONT_STACK = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** The longest family name that the field accepts. A real family name is far shorter. */
const MAX_FAMILY_LENGTH = 64;

/** Letters, numbers, spaces, and the punctuation that font family names use. */
const FAMILY_SHAPE = /^[\p{L}\p{N} ._()+-]+$/u;

/** The choice for this page after the browser did not save it. It wins over an older saved value. */
let unsavedPreference: string | null | undefined;

/**
 * The family name as a saved value, or null for the default font. A name that cannot be a CSS
 * family name, or that is longer than a family name gets, reads as the default.
 */
export function normalizeInterfaceFontFamily(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const family = value.replace(/\s+/g, " ").trim();
  if (family.length === 0 || family.length > MAX_FAMILY_LENGTH) return null;
  return FAMILY_SHAPE.test(family) ? family : null;
}

/**
 * The value of `--openbot-font-sans` for a family: the family, quoted, then the default stack.
 * Null for the default font, where the brand token stays in place.
 */
export function interfaceFontStack(family: string | null): string | null {
  const normalized = normalizeInterfaceFontFamily(family);
  return normalized === null ? null : `"${normalized}", ${DEFAULT_INTERFACE_FONT_STACK}`;
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The saved family for this device, or null for the default. Reading `window.localStorage` throws
 * when the browser blocks storage, so it is read inside the guard.
 */
export function readInterfaceFont(): string | null {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return normalizeInterfaceFontFamily(window.localStorage.getItem(INTERFACE_FONT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeInterfaceFont(family: string | null): void {
  const local = storage();
  if (local === undefined) {
    // Blocked storage keeps the choice for this page only.
    unsavedPreference = family;
    return;
  }
  try {
    if (family === null) local.removeItem(INTERFACE_FONT_STORAGE_KEY);
    else local.setItem(INTERFACE_FONT_STORAGE_KEY, family);
    unsavedPreference = undefined;
  } catch {
    // Full storage keeps the choice for this page only.
    unsavedPreference = family;
  }
}

/** Sets the font stack of this window. Removing the property brings back the brand token. */
export function applyInterfaceFont(family: string | null): void {
  const stack = interfaceFontStack(family);
  if (stack === null) document.documentElement.style.removeProperty("--openbot-font-sans");
  else document.documentElement.style.setProperty("--openbot-font-sans", stack);
}

const [interfaceFont, setInterfaceFontSignal] = createSignal(readInterfaceFont());

function readStorageIntoSignal(event: StorageEvent): void {
  if (event.key !== null && event.key !== INTERFACE_FONT_STORAGE_KEY) return;
  const family = readInterfaceFont();
  setInterfaceFontSignal(family);
  applyInterfaceFont(family);
}

if (typeof window !== "undefined") {
  // One registration per page: addEventListener ignores the same listener twice, and HMR
  // disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorageIntoSignal);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorageIntoSignal);
  });
}

/**
 * Applies the saved family to this window, and keeps every window on a choice that another window
 * makes. Every desktop window shares the storage, so Settings changes reach an open chat at once.
 */
export function syncInterfaceFont(): void {
  applyInterfaceFont(readInterfaceFont());
}

/** The shared reactive preference. */
export function useInterfaceFont(): () => string | null {
  return interfaceFont;
}

export function setInterfaceFont(family: string | null): void {
  const normalized = normalizeInterfaceFontFamily(family);
  writeInterfaceFont(normalized);
  setInterfaceFontSignal(normalized);
  applyInterfaceFont(normalized);
}
