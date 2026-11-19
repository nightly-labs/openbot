import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { BrowserWindow } from "electron";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("linux-x11-activation");
const requireModule = createRequire(import.meta.url);

const X11_CLIENT_MESSAGE_EVENT = 33;
const SUBSTRUCTURE_NOTIFY_MASK = 1 << 19;
const SUBSTRUCTURE_REDIRECT_MASK = 1 << 20;
const EWMH_SOURCE_PAGER_OR_TOOL = 2;
const X11_CURRENT_TIME = 0;
const NO_REQUESTOR_ACTIVE_WINDOW = 0;
const X_EVENT_SIZE_IN_LONGS = 24;

interface Xlib {
  koffi: typeof Koffi;
  openDisplay: (name: null) => unknown;
  closeDisplay: (display: unknown) => number;
  defaultRootWindow: (display: unknown) => number;
  internAtom: (display: unknown, name: string, onlyIfExists: number) => number;
  sendEvent: (display: unknown, window: number, propagate: number, mask: number, event: unknown) => number;
}

let xlibAfterFirstLoad: Xlib | null | undefined;

function loadXlibOnce(): Xlib | null {
  if (xlibAfterFirstLoad !== undefined) return xlibAfterFirstLoad;
  try {
    const koffi: typeof Koffi = requireModule("koffi");
    const library = koffi.load("libX11.so.6");
    const clientMessage = koffi.struct("OpenBotXClientMessageEvent", {
      type: "int",
      serial: "unsigned long",
      send_event: "int",
      display: "void *",
      window: "unsigned long",
      message_type: "unsigned long",
      format: "int",
      data: koffi.array("long", 5),
    });
    const event = koffi.union("OpenBotXEvent", {
      xclient: clientMessage,
      pad: koffi.array("long", X_EVENT_SIZE_IN_LONGS),
    });
    xlibAfterFirstLoad = {
      koffi,
      openDisplay: library.func("void *XOpenDisplay(const char *name)"),
      closeDisplay: library.func("int XCloseDisplay(void *display)"),
      defaultRootWindow: library.func("unsigned long XDefaultRootWindow(void *display)"),
      internAtom: library.func("unsigned long XInternAtom(void *display, const char *name, int only_if_exists)"),
      sendEvent: library.func("XSendEvent", "int", ["void *", "unsigned long", "int", "long", koffi.pointer(event)]),
    };
  } catch (error) {
    xlibAfterFirstLoad = null;
    logger.warn("Unable to load Xlib to focus dock windows:", toLogValue(error));
  }
  return xlibAfterFirstLoad;
}

export function forceActivateX11Window(window: BrowserWindow): void {
  if (process.platform !== "linux") return;
  const x = loadXlibOnce();
  if (!x) return;
  try {
    const handle = window.getNativeWindowHandle();
    const xid = Number(x.koffi.decode(handle, handle.length === 8 ? "uint64_t" : "uint32_t"));
    const display = x.openDisplay(null);
    if (!display) {
      logger.warn("Unable to open the X11 display to focus a dock window.");
      return;
    }
    try {
      x.sendEvent(display, x.defaultRootWindow(display), 0, SUBSTRUCTURE_NOTIFY_MASK | SUBSTRUCTURE_REDIRECT_MASK, {
        xclient: {
          type: X11_CLIENT_MESSAGE_EVENT,
          serial: 0,
          send_event: 1,
          display,
          window: xid,
          message_type: x.internAtom(display, "_NET_ACTIVE_WINDOW", 0),
          format: 32,
          data: [EWMH_SOURCE_PAGER_OR_TOOL, X11_CURRENT_TIME, NO_REQUESTOR_ACTIVE_WINDOW, 0, 0],
        },
      });
    } finally {
      x.closeDisplay(display);
    }
  } catch (error) {
    logger.warn("Unable to ask the X11 window manager to focus a dock window:", toLogValue(error));
  }
}
