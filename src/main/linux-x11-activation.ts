import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { BrowserWindow } from "electron";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("linux-x11-activation");
const requireModule = createRequire(import.meta.url);

/** `ClientMessage` in `X11/X.h`. */
const CLIENT_MESSAGE = 33;
/** `SubstructureNotifyMask | SubstructureRedirectMask`: the mask that EWMH asks for a root window message. */
const ROOT_MESSAGE_MASK = (1 << 19) | (1 << 20);
/** EWMH source indication of a pager or other tool. The window manager does not apply its focus rules to it. */
const SOURCE_TOOL = 2;

interface Xlib {
  koffi: typeof Koffi;
  openDisplay: (name: null) => unknown;
  closeDisplay: (display: unknown) => number;
  defaultRootWindow: (display: unknown) => number;
  internAtom: (display: unknown, name: string, onlyIfExists: number) => number;
  sendEvent: (display: unknown, window: number, propagate: number, mask: number, event: unknown) => number;
}

let xlib: Xlib | null = null;

function loadXlib(): Xlib {
  if (xlib) return xlib;
  // Loaded on first use, so that only an X11 dock or island loads the FFI.
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
  // `XSendEvent` takes the whole `XEvent` union, which is 24 longs.
  const event = koffi.union("OpenBotXEvent", { xclient: clientMessage, pad: koffi.array("long", 24) });
  xlib = {
    koffi,
    openDisplay: library.func("void *XOpenDisplay(const char *name)"),
    closeDisplay: library.func("int XCloseDisplay(void *display)"),
    defaultRootWindow: library.func("unsigned long XDefaultRootWindow(void *display)"),
    internAtom: library.func("unsigned long XInternAtom(void *display, const char *name, int only_if_exists)"),
    sendEvent: library.func("XSendEvent", "int", ["void *", "unsigned long", "int", "long", koffi.pointer(event)]),
  };
  return xlib;
}

/**
 * Asks the X11 window manager to give the key focus to a dock window, as the Plasma panel does
 * (`KX11Extras::forceActiveWindow`).
 *
 * The agent dock and the Dynamic Island are `_NET_WM_WINDOW_TYPE_DOCK` windows. `BrowserWindow.focus()`
 * sends `_NET_ACTIVE_WINDOW` as an application request, and KWin up to Plasma 6.3 gives no focus to a
 * dock window for such a request or for a click on it. Text typed in the dock then goes to another
 * window (#7415). A request from a tool is not refused. Call it only after the user pressed a text
 * field of the window. When Xlib is missing or fails, the window keeps the result of `focus()`.
 */
export function forceActivateX11Window(window: BrowserWindow): void {
  if (process.platform !== "linux") return;
  try {
    const x = loadXlib();
    const handle = window.getNativeWindowHandle();
    const xid = Number(x.koffi.decode(handle, handle.length === 8 ? "uint64_t" : "uint32_t"));
    const display = x.openDisplay(null);
    if (!display) {
      logger.warn("Unable to open the X11 display to focus a dock window.");
      return;
    }
    try {
      const sent = x.sendEvent(display, x.defaultRootWindow(display), 0, ROOT_MESSAGE_MASK, {
        xclient: {
          type: CLIENT_MESSAGE,
          serial: 0,
          send_event: 1,
          display,
          window: xid,
          message_type: x.internAtom(display, "_NET_ACTIVE_WINDOW", 0),
          format: 32,
          // Source, timestamp (CurrentTime), the active window of the requestor (none).
          data: [SOURCE_TOOL, 0, 0, 0, 0],
        },
      });
      if (sent === 0) logger.warn("The X11 server did not take the focus request of a dock window.");
    } finally {
      // Closing the display also sends the request.
      x.closeDisplay(display);
    }
  } catch (error) {
    logger.warn("Unable to ask the X11 window manager to focus a dock window:", toLogValue(error));
  }
}
