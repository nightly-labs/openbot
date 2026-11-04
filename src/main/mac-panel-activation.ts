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
}

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
