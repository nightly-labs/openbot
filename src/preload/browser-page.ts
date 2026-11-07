import { contextBridge } from "electron";

// The preload of the agent browser tabs. It has no IPC and exposes no world: the page gets no
// `window.openbot` and no path to main. It only runs `matchChromePageValues` in the page world of
// each frame, before the page's own scripts.

/**
 * Makes the values that bot checks read from an Electron tab agree with Chrome:
 * - A hidden tab, or a tab of a minimized window, reports an outer size of 0x0 (Windows: 160x28),
 *   smaller than its viewport. Chrome's outer size always holds the viewport.
 * - Minimized Windows windows report a screen position of -32000.
 * - Electron's `window.chrome` is an empty object, and a `srcdoc` frame read before it loads has
 *   none. Chrome has `loadTimes`, `csi` and `app`.
 *
 * Electron serializes this function into the page, so it must use nothing from outside its body.
 * Each replaced function reads as native code through `Function.prototype.toString`.
 */
function matchChromePageValues(): void {
  const natives = new WeakMap<object, string>();
  const onWindows = navigator.userAgent.includes("Windows");
  // The window frame and toolbar of a Chrome window with no bookmarks bar.
  const frameWidth = onWindows ? 16 : 0;
  const toolbarHeight = onWindows ? 87 : 85;

  const isGlobal = (value: Window | null): value is Window & typeof globalThis => {
    try {
      // A frame of another origin throws here, and its values are not ours to change.
      return value !== null && "Function" in value && typeof value.Function === "function";
    } catch {
      return false;
    }
  };

  const wrapGetter = <Owner extends typeof globalThis | HTMLIFrameElement, Key extends keyof Owner & string>(
    owner: Owner,
    key: Key,
    fix: (value: Owner[Key]) => Owner[Key],
  ): void => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const get = descriptor?.get;
    if (!descriptor || !get) return;
    const wrapped = new Proxy(get, { apply: (method, self: unknown) => fix(method.call(self)) });
    natives.set(wrapped, `get ${key}`);
    Object.defineProperty(owner, key, { ...descriptor, get: wrapped });
  };

  const chromeValues = (target: typeof globalThis) => {
    const performance = target.performance;
    const navigation = (): PerformanceNavigationTiming | undefined => {
      const entry = performance.getEntriesByType("navigation")[0];
      return entry instanceof target.PerformanceNavigationTiming ? entry : undefined;
    };
    // Seconds since the epoch, as Chrome reports them. A step that has not happened yet is 0.
    const seconds = (offset: number | undefined) => (offset ? (performance.timeOrigin + offset) / 1000 : 0);
    const methods = {
      loadTimes() {
        const entry = navigation();
        const protocol = entry?.nextHopProtocol ?? "";
        const multiplexed = protocol === "h2" || protocol === "h3";
        const paint = performance.getEntriesByName("first-paint")[0];
        const navigationType =
          entry?.type === "reload" ? "Reload" : entry?.type === "back_forward" ? "BackForward" : "Other";
        return {
          requestTime: performance.timeOrigin / 1000,
          startLoadTime: performance.timeOrigin / 1000,
          commitLoadTime: seconds(entry?.responseStart),
          finishDocumentLoadTime: seconds(entry?.domContentLoadedEventEnd),
          finishLoadTime: seconds(entry?.loadEventEnd),
          firstPaintTime: seconds(paint?.startTime),
          firstPaintAfterLoadTime: 0,
          navigationType,
          wasFetchedViaSpdy: multiplexed,
          wasNpnNegotiated: multiplexed,
          npnNegotiatedProtocol: multiplexed ? protocol : "unknown",
          wasAlternateProtocolAvailable: false,
          connectionInfo: protocol || "http/1.1",
        };
      },
      csi() {
        const entry = navigation();
        return {
          startE: Math.round(performance.timeOrigin),
          onloadT: Math.round(performance.timeOrigin + (entry?.domContentLoadedEventEnd ?? 0)),
          pageT: performance.now(),
          tran: 15,
        };
      },
    };
    const app = {
      isInstalled: false,
      InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
      RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
      getDetails() {
        return null;
      },
      getIsInstalled() {
        return false;
      },
      installState(callback?: unknown) {
        if (typeof callback === "function") callback("not_installed");
      },
      runningState() {
        return "cannot_run";
      },
    };
    for (const name of ["getDetails", "getIsInstalled", "installState", "runningState"] as const) {
      natives.set(app[name], name);
    }
    natives.set(methods.loadTimes, "loadTimes");
    natives.set(methods.csi, "csi");
    return { loadTimes: methods.loadTimes, csi: methods.csi, app };
  };

  const install = (target: typeof globalThis): void => {
    const existing = "chrome" in target && typeof target.chrome === "object" ? target.chrome : null;
    if (existing && "loadTimes" in existing && typeof existing.loadTimes === "function") return;

    const functionPrototype = target.Function.prototype;
    const maskedToString = new Proxy(functionPrototype.toString, {
      apply: (method, self: unknown) => {
        const name = typeof self === "function" ? natives.get(self) : undefined;
        return name === undefined ? method.call(self) : `function ${name}() { [native code] }`;
      },
    });
    natives.set(maskedToString, "toString");
    Object.defineProperty(functionPrototype, "toString", { value: maskedToString });

    const chrome = existing ?? {};
    for (const [key, value] of Object.entries(chromeValues(target))) {
      Object.defineProperty(chrome, key, { value, writable: true, enumerable: true, configurable: true });
    }
    if (chrome !== existing) {
      Object.defineProperty(target, "chrome", { value: chrome, writable: true, enumerable: true, configurable: true });
    }

    const innerSize = (key: "innerWidth" | "innerHeight"): number => {
      try {
        // A frame's outer size is the size of the top window, as in Chrome.
        return target.top?.[key] ?? target[key];
      } catch {
        return target[key];
      }
    };
    wrapGetter(target, "outerWidth", (value) =>
      value < innerSize("innerWidth") ? innerSize("innerWidth") + frameWidth : value,
    );
    wrapGetter(target, "outerHeight", (value) =>
      value <= innerSize("innerHeight") ? innerSize("innerHeight") + toolbarHeight : value,
    );
    for (const key of ["screenX", "screenY", "screenLeft", "screenTop"] as const) {
      wrapGetter(target, key, (value) => (value <= -10_000 ? 0 : value));
    }
    // A page can read a new frame's window before the frame's own document, and this preload,
    // load. That window gets the same values here.
    wrapGetter(target.HTMLIFrameElement.prototype, "contentWindow", (value) => {
      if (isGlobal(value)) {
        try {
          install(value);
        } catch {
          // A frame that refuses a change keeps its own values.
        }
      }
      return value;
    });
  };

  install(globalThis);
}

contextBridge.executeInMainWorld({ func: matchChromePageValues });
