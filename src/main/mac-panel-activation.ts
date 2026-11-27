import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { BaseWindow, BrowserWindow } from "electron";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("mac-panel-activation");
const requireModule = createRequire(import.meta.url);

interface ObjcRuntime {
  pointerOf: (handle: Buffer) => unknown;
  sel: (name: string) => unknown;
  getClass: (name: string) => unknown;
  sendPointer: (receiver: unknown, selector: unknown) => unknown;
  sendRespondsTo: (receiver: unknown, selector: unknown, query: unknown) => boolean;
  sendBool: (receiver: unknown, selector: unknown, value: boolean) => void;
  sendCString: (receiver: unknown, selector: unknown, value: string) => unknown;
  sendSetPointer: (receiver: unknown, selector: unknown, value: unknown) => void;
}

let runtime: ObjcRuntime | null = null;

function objcRuntime(): ObjcRuntime {
  if (runtime) return runtime;
  const koffi: typeof Koffi = requireModule("koffi");
  const objc = koffi.load("/usr/lib/libobjc.A.dylib");
  runtime = {
    pointerOf: (handle) => koffi.decode(handle, "void *"),
    sel: objc.func("void *sel_registerName(const char *name)"),
    getClass: objc.func("void *objc_getClass(const char *name)"),
    sendPointer: objc.func("objc_msgSend", "void *", ["void *", "void *"]),
    sendRespondsTo: objc.func("objc_msgSend", "bool", ["void *", "void *", "void *"]),
    sendBool: objc.func("objc_msgSend", "void", ["void *", "void *", "bool"]),
    sendCString: objc.func("objc_msgSend", "void *", ["void *", "void *", "const char *"]),
    sendSetPointer: objc.func("objc_msgSend", "void", ["void *", "void *", "void *"]),
  };
  return runtime;
}

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

export function hidePanelFromWindowSwitchers(window: BaseWindow): void {
  if (process.platform !== "darwin") return;
  try {
    const objc = objcRuntime();
    const nsWindow = objc.sendPointer(objc.pointerOf(window.getNativeWindowHandle()), objc.sel("window"));
    const setSubrole = objc.sel("setAccessibilitySubrole:");
    if (!nsWindow || !objc.sendRespondsTo(nsWindow, objc.sel("respondsToSelector:"), setSubrole)) {
      logger.warn("The panel window has no setAccessibilitySubrole: method.");
      return;
    }
    const subrole = objc.sendCString(objc.getClass("NSString"), objc.sel("stringWithUTF8String:"), "AXFloatingWindow");
    if (!subrole) {
      logger.warn("Unable to make the floating window subrole.");
      return;
    }
    objc.sendSetPointer(nsWindow, setSubrole, subrole);
  } catch (error) {
    logger.warn("Unable to hide the panel from window switchers:", toLogValue(error));
  }
}

export function keepPanelThroughAppHide(window: BrowserWindow): void {
  if (process.platform !== "darwin") return;
  try {
    const objc = objcRuntime();
    const nsWindow = objc.sendPointer(objc.pointerOf(window.getNativeWindowHandle()), objc.sel("window"));
    const setCanHide = objc.sel("setCanHide:");
    if (!nsWindow || !objc.sendRespondsTo(nsWindow, objc.sel("respondsToSelector:"), setCanHide)) {
      logger.warn("The panel window has no setCanHide: method.");
      return;
    }
    objc.sendBool(nsWindow, setCanHide, false);
  } catch (error) {
    logger.warn("Unable to keep the panel on screen when OpenBot hides:", toLogValue(error));
  }
}
