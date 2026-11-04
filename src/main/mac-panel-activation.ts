import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { BrowserWindow } from "electron";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("mac-panel-activation");
const requireModule = createRequire(import.meta.url);

interface ObjcRuntime {
  pointerOf: (handle: Buffer) => unknown;
  sel: (name: string) => unknown;
  sendPointer: (receiver: unknown, selector: unknown) => unknown;
  sendRespondsTo: (receiver: unknown, selector: unknown, query: unknown) => boolean;
  sendBool: (receiver: unknown, selector: unknown, value: boolean) => void;
  sendCollectionBehavior: (receiver: unknown, selector: unknown) => number | bigint;
  sendSetCollectionBehavior: (receiver: unknown, selector: unknown, value: number | bigint) => void;
}

const NS_WINDOW_COLLECTION_BEHAVIOR_MANAGED = 1 << 2;
const NS_WINDOW_COLLECTION_BEHAVIOR_TRANSIENT = 1 << 3;
const NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY = 1 << 4;

let runtime: ObjcRuntime | null = null;

function objcRuntime(): ObjcRuntime {
  if (runtime) return runtime;
  // Loaded on first use, so that only a macOS panel loads the FFI.
  const koffi: typeof Koffi = requireModule("koffi");
  const objc = koffi.load("/usr/lib/libobjc.A.dylib");
  // `objc_msgSend` must be called through the exact prototype of each method, never as a variadic.
  runtime = {
    pointerOf: (handle) => koffi.decode(handle, "void *"),
    sel: objc.func("void *sel_registerName(const char *name)"),
    sendPointer: objc.func("objc_msgSend", "void *", ["void *", "void *"]),
    sendRespondsTo: objc.func("objc_msgSend", "bool", ["void *", "void *", "void *"]),
    sendBool: objc.func("objc_msgSend", "void", ["void *", "void *", "bool"]),
    sendCollectionBehavior: objc.func("objc_msgSend", "uint64", ["void *", "void *"]),
    sendSetCollectionBehavior: objc.func("objc_msgSend", "void", ["void *", "void *", "uint64"]),
  };
  return runtime;
}

/**
 * Stops a macOS panel from making OpenBot the active application.
 *
 * Electron's `type: "panel"` window reports the non-activating style only from its own `styleMask`
 * getter, so the window server never learns that the panel must not take activation. When the user
 * switches to an application that has no window on the current Space, macOS can then give
 * activation to the owner of the topmost window, which is the Dynamic Island (#3497). AppKit has no
 * public API to set this after the window exists, so this calls the private
 * `_setPreventsActivation:` that `NSPanel` uses for its own non-activating style. When the method is
 * missing, the panel stays as it was.
 */
export function preventPanelActivation(window: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  try {
    const objc = objcRuntime();
    const nsWindow = objc.sendPointer(objc.pointerOf(window.getNativeWindowHandle()), objc.sel("window"));
    const setPreventsActivation = objc.sel("_setPreventsActivation:");
    if (!nsWindow || !objc.sendRespondsTo(nsWindow, objc.sel("respondsToSelector:"), setPreventsActivation)) {
      logger.warn("The panel window has no _setPreventsActivation: method.");
      return;
    }
    objc.sendBool(nsWindow, setPreventsActivation, true);
  } catch (error) {
    logger.warn("Unable to stop the panel from activating OpenBot:", toLogValue(error));
  }
}

/**
 * Keeps the panel on its own Space while the user works on another one.
 *
 * AppKit allows at most one of `Managed`, `Transient` and `Stationary`, and a non-normal window
 * level defaults to `Transient`. Electron also sets `Transient` in `setHiddenInMissionControl`.
 * OR-ing `Stationary` alone therefore leaves `Transient` in the mask, and macOS still brings
 * OpenBot's Space back about half a second after the user switches away (#3497). This clears
 * `Managed` and `Transient` first, then sets `Stationary`. `Stationary` also keeps the island
 * visible in Mission Control, which is the trade-off of this behavior.
 */
export function keepPanelStationary(window: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  try {
    const objc = objcRuntime();
    const nsWindow = objc.sendPointer(objc.pointerOf(window.getNativeWindowHandle()), objc.sel("window"));
    const getCollectionBehavior = objc.sel("collectionBehavior");
    const setCollectionBehavior = objc.sel("setCollectionBehavior:");
    if (
      !nsWindow ||
      !objc.sendRespondsTo(nsWindow, objc.sel("respondsToSelector:"), getCollectionBehavior) ||
      !objc.sendRespondsTo(nsWindow, objc.sel("respondsToSelector:"), setCollectionBehavior)
    ) {
      logger.warn("The panel window has no collectionBehavior methods.");
      return;
    }
    // NSWindowCollectionBehavior is an NSUInteger. Its flags are small, so Number() is exact.
    const behavior = Number(objc.sendCollectionBehavior(nsWindow, getCollectionBehavior));
    if (!Number.isFinite(behavior)) {
      logger.warn("The panel window reported an invalid collectionBehavior.");
      return;
    }
    objc.sendSetCollectionBehavior(
      nsWindow,
      setCollectionBehavior,
      (behavior & ~(NS_WINDOW_COLLECTION_BEHAVIOR_MANAGED | NS_WINDOW_COLLECTION_BEHAVIOR_TRANSIENT)) |
        NS_WINDOW_COLLECTION_BEHAVIOR_STATIONARY,
    );
  } catch (error) {
    logger.warn("Unable to keep the panel stationary:", toLogValue(error));
  }
}
