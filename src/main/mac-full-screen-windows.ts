import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { Display, Rectangle } from "electron";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("mac-full-screen-windows");
const requireModule = createRequire(import.meta.url);

/** `kCGWindowListOptionOnScreenOnly`. */
const ON_SCREEN_ONLY = 1 << 0;
const NORMAL_WINDOW_LAYER = 0;
/** `kCGDesktopIconWindowLevelKey`. */
const DESKTOP_ICON_LEVEL_KEY = 18;
const CF_NUMBER_SINT64 = 4;
const CF_STRING_ENCODING_UTF8 = 0x08000100;

interface WindowListRuntime {
  copyOnScreenWindows: () => unknown;
  count: (array: unknown) => number;
  at: (array: unknown, index: number) => unknown;
  value: (dictionary: unknown, key: unknown) => unknown;
  integer: (value: unknown) => number | null;
  rectangle: (dictionary: unknown) => Rectangle | null;
  release: (value: unknown) => void;
  desktopIconLayer: number;
  keys: { layer: unknown; ownerPid: unknown; bounds: unknown };
}

let runtime: WindowListRuntime | null = null;
let runtimeFailed = false;

function windowListRuntime(): WindowListRuntime {
  if (runtime) return runtime;
  // Loaded on first use, so that only macOS loads the FFI.
  const koffi: typeof Koffi = requireModule("koffi");
  const cf = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const cg = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
  const rect = koffi.struct({ x: "double", y: "double", width: "double", height: "double" });
  const copyWindowInfo = cg.func("void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeToWindow)");
  const rectFromDictionary = cg.func("CGRectMakeWithDictionaryRepresentation", "bool", [
    "void *",
    koffi.out(koffi.pointer(rect)),
  ]);
  const getNumber = cf.func("bool CFNumberGetValue(void *number, long type, _Out_ int64_t *value)");
  const createString = cf.func("void *CFStringCreateWithCString(void *allocator, const char *text, uint32_t encoding)");
  runtime = {
    copyOnScreenWindows: () => copyWindowInfo(ON_SCREEN_ONLY, 0),
    count: cf.func("long CFArrayGetCount(void *array)"),
    at: cf.func("void *CFArrayGetValueAtIndex(void *array, long index)"),
    value: cf.func("void *CFDictionaryGetValue(void *dictionary, void *key)"),
    integer: (value) => {
      const out = [0];
      return value && getNumber(value, CF_NUMBER_SINT64, out) ? Number(out[0]) : null;
    },
    rectangle: (dictionary) => {
      const out: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
      return dictionary && rectFromDictionary(dictionary, out) ? out : null;
    },
    release: cf.func("void CFRelease(void *value)"),
    desktopIconLayer: cg.func("int CGWindowLevelForKey(int key)")(DESKTOP_ICON_LEVEL_KEY),
    // The key constants are CFStrings that hold their own names. They stay for the life of the process.
    keys: {
      layer: createString(null, "kCGWindowLayer", CF_STRING_ENCODING_UTF8),
      ownerPid: createString(null, "kCGWindowOwnerPID", CF_STRING_ENCODING_UTF8),
      bounds: createString(null, "kCGWindowBounds", CF_STRING_ENCODING_UTF8),
    },
  };
  return runtime;
}

function covers(window: Rectangle, display: Rectangle): boolean {
  return (
    window.x <= display.x &&
    window.y <= display.y &&
    window.x + window.width >= display.x + display.width &&
    window.y + window.height >= display.y + display.height
  );
}

/**
 * The displays that show a full-screen app of another application on the active Space, such as a video,
 * a game or slides. A window of another application fills the display, and the desktop is not shown
 * there: Finder's desktop window covers each display on a desktop Space and is absent from a full-screen
 * Space, so a window that fills a desktop does not count. When Finder shows no desktop, the filling
 * window alone decides. Only the window list is read: owner, level and bounds, which macOS gives without
 * the Screen Recording permission. When the list cannot be read, no display is filled.
 */
export function displaysFilledByOtherApps(displays: readonly Display[]): ReadonlySet<number> {
  const filled = new Set<number>();
  if (process.platform !== "darwin" || displays.length === 0 || runtimeFailed) return filled;
  let cg: WindowListRuntime;
  try {
    cg = windowListRuntime();
  } catch (error) {
    runtimeFailed = true;
    logger.warn("Unable to load the window list functions:", toLogValue(error));
    return filled;
  }
  const desktops = new Set<number>();
  try {
    const windows = cg.copyOnScreenWindows();
    if (!windows) return filled;
    try {
      const count = cg.count(windows);
      for (let index = 0; index < count; index += 1) {
        const window = cg.at(windows, index);
        const layer = cg.integer(cg.value(window, cg.keys.layer));
        const desktop = layer === cg.desktopIconLayer;
        if (!desktop && layer !== NORMAL_WINDOW_LAYER) continue;
        if (!desktop && cg.integer(cg.value(window, cg.keys.ownerPid)) === process.pid) continue;
        const bounds = cg.rectangle(cg.value(window, cg.keys.bounds));
        if (!bounds) continue;
        for (const display of displays) {
          if (covers(bounds, display.bounds)) (desktop ? desktops : filled).add(display.id);
        }
      }
    } finally {
      cg.release(windows);
    }
  } catch (error) {
    logger.warn("Unable to read the window list:", toLogValue(error));
    return new Set();
  }
  for (const id of desktops) filled.delete(id);
  return filled;
}
