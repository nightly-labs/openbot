import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { BrowserWindow } from "electron";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("windows-topmost-keeper");
const requireModule = createRequire(import.meta.url);

const TOPMOST_CHECK_MS = 2000;
const GW_HWNDPREV = 3;
const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x8;
const DWMWA_CLOAKED = 14;
const HWND_TOPMOST = -1;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const MAX_WINDOWS_ABOVE = 1024;

type WindowHandle = number | bigint;

interface ZOrderApi {
  windowAbove: (window: WindowHandle, command: number) => WindowHandle;
  extendedStyle: (window: WindowHandle, index: number) => number;
  isVisible: (window: WindowHandle) => number;
  readAttribute: (window: WindowHandle, attribute: number, value: [number], size: number) => number;
  setPosition: (
    window: WindowHandle,
    insertAfter: WindowHandle,
    x: number,
    y: number,
    width: number,
    height: number,
    flags: number,
  ) => number;
}

let zOrderApi: ZOrderApi | null | undefined;
let raiseFailureLogged = false;

function loadZOrderApi(): ZOrderApi | null {
  if (zOrderApi !== undefined) return zOrderApi;
  try {
    const koffi: typeof Koffi = requireModule("koffi");
    const user32 = koffi.load("user32.dll");
    const dwmapi = koffi.load("dwmapi.dll");
    zOrderApi = {
      windowAbove: user32.func("intptr_t __stdcall GetWindow(intptr_t window, uint32_t command)"),
      extendedStyle: user32.func("int32_t __stdcall GetWindowLongW(intptr_t window, int index)"),
      isVisible: user32.func("int __stdcall IsWindowVisible(intptr_t window)"),
      readAttribute: dwmapi.func(
        "int32_t __stdcall DwmGetWindowAttribute(intptr_t window, uint32_t attribute, _Out_ uint32_t *value, uint32_t size)",
      ),
      setPosition: user32.func(
        "int __stdcall SetWindowPos(intptr_t window, intptr_t insertAfter, int x, int y, int width, int height, uint32_t flags)",
      ),
    };
  } catch (error) {
    zOrderApi = null;
    logger.warn("Unable to load the Windows z-order functions:", toLogValue(error));
  }
  return zOrderApi;
}

function nativeHandle(window: BrowserWindow): WindowHandle {
  const handle = window.getNativeWindowHandle();
  return handle.length === 8 ? handle.readBigInt64LE(0) : handle.readInt32LE(0);
}

function shownNormalWindow(api: ZOrderApi, window: WindowHandle): boolean {
  if (!api.isVisible(window)) return false;
  if ((api.extendedStyle(window, GWL_EXSTYLE) & WS_EX_TOPMOST) !== 0) return false;
  const cloaked: [number] = [0];
  return api.readAttribute(window, DWMWA_CLOAKED, cloaked, 4) !== 0 || cloaked[0] === 0;
}

function belowShownNormalWindow(api: ZOrderApi, window: WindowHandle): boolean {
  let above = api.windowAbove(window, GW_HWNDPREV);
  for (let step = 0; above && step < MAX_WINDOWS_ABOVE; step++) {
    if (shownNormalWindow(api, above)) return true;
    above = api.windowAbove(above, GW_HWNDPREV);
  }
  return false;
}

function raiseIntoTopmostBand(window: BrowserWindow): void {
  const api = loadZOrderApi();
  if (!api) return;
  try {
    const handle = nativeHandle(window);
    if (!belowShownNormalWindow(api, handle)) return;
    api.setPosition(handle, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  } catch (error) {
    if (raiseFailureLogged) return;
    raiseFailureLogged = true;
    logger.warn("Unable to keep a window in the Windows topmost band:", toLogValue(error));
  }
}

export class WindowsTopmostKeeper {
  readonly #windows = new Set<BrowserWindow>();
  #timer: ReturnType<typeof setInterval> | undefined;

  keep(window: BrowserWindow): void {
    if (this.#windows.has(window)) return;
    this.#windows.add(window);
    window.on("show", this.#schedule);
    window.on("hide", this.#schedule);
    window.once("closed", () => {
      this.#windows.delete(window);
      this.#schedule();
    });
    this.#schedule();
  }

  readonly #check = (): void => {
    for (const window of this.#windows) {
      if (window.isDestroyed() || !window.isVisible()) continue;
      if (window.isAlwaysOnTop()) raiseIntoTopmostBand(window);
      else window.setAlwaysOnTop(true, "normal");
    }
  };

  readonly #schedule = (): void => {
    const active = [...this.#windows].some((window) => !window.isDestroyed() && window.isVisible());
    if (active && this.#timer === undefined) this.#timer = setInterval(this.#check, TOPMOST_CHECK_MS);
    if (!active && this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  };
}
