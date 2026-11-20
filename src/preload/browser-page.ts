import { contextBridge } from "electron";

function matchChromePageValues(): void {
  const nativesRequest = "matchChromePageValues:natives";
  const onWindows = navigator.userAgent.includes("Windows");
  const onMac = navigator.userAgent.includes("Macintosh");
  const onLinux = navigator.userAgent.includes("Linux");
  const frameWidth = onWindows ? 16 : 0;
  const toolbarHeight = onWindows ? 87 : 85;

  const isGlobal = (value: Window | null): value is Window & typeof globalThis => {
    try {
      return value !== null && "Function" in value && typeof value.Function === "function";
    } catch {
      return false;
    }
  };

  const sharedNatives = (): WeakMap<object, string> => {
    let shared: WeakMap<object, string> | undefined;
    let frame: Window = window;
    try {
      while (frame.parent !== frame) {
        frame = frame.parent;
        if (!isGlobal(frame)) continue;
        const request: { [nativesRequest]: WeakMap<object, string> | undefined } = { [nativesRequest]: undefined };
        try {
          frame.Function.prototype.toString.call(request);
        } catch {}
        shared = request[nativesRequest] ?? shared;
      }
    } catch {}
    return shared ?? new WeakMap<object, string>();
  };
  const natives = sharedNatives();

  const removeTrapFrame = (error: unknown): void => {
    try {
      if (typeof error === "object" && error !== null && "stack" in error && typeof error.stack === "string") {
        const lines = error.stack.split("\n");
        const trap = lines.findIndex(
          (line, index) => index > 0 && /^\s+at Object\.(?:apply|setPrototypeOf) \(<anonymous>:\d+:\d+\)$/.test(line),
        );
        if (trap > 0) {
          lines.splice(trap, 1);
          error.stack = lines.join("\n");
        }
      }
    } catch {}
  };

  const nativeProxy = <Method extends (...args: never[]) => unknown>(
    realm: typeof globalThis,
    method: Method,
    apply: NonNullable<ProxyHandler<Method>["apply"]>,
  ): Method => {
    const proxy: Method = new Proxy(method, {
      apply,
      setPrototypeOf: (inner, prototype: object | null) => {
        for (let next = prototype, depth = 0; next !== null && depth < 10_000; depth += 1) {
          if (next === proxy || next === inner) {
            const error = new realm.TypeError("Cyclic __proto__ value");
            removeTrapFrame(error);
            throw error;
          }
          next = Object.getPrototypeOf(next);
        }
        return Reflect.setPrototypeOf(inner, prototype);
      },
    });
    return proxy;
  };

  const wrapGetter = <Owner extends typeof globalThis | HTMLIFrameElement, Key extends keyof Owner & string>(
    realm: typeof globalThis,
    owner: Owner,
    key: Key,
    fix: (value: Owner[Key]) => Owner[Key],
  ): void => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    const get = descriptor?.get;
    if (!descriptor || !get) return;
    const wrapped = nativeProxy(realm, get, (method, self: unknown) => {
      let value: Owner[Key];
      try {
        value = method.call(self);
      } catch (error) {
        removeTrapFrame(error);
        throw error;
      }
      return fix(value);
    });
    natives.set(wrapped, `get ${key}`);
    Object.defineProperty(owner, key, { ...descriptor, get: wrapped });
  };

  const securityKeyTransports = new Set(["usb", "nfc", "ble", "smart-card"]);
  const opensPasskeyDialog = (options: CredentialRequestOptions | undefined): boolean => {
    try {
      const publicKey = options?.publicKey;
      if (!publicKey || options.mediation === "conditional" || options.signal?.aborted) return false;
      if ("hints" in publicKey && Array.isArray(publicKey.hints) && publicKey.hints.includes("security-key")) {
        return false;
      }
      return !Array.from(publicKey.allowCredentials ?? []).some((credential) => {
        const transports = Array.from(credential.transports ?? []);
        return transports.length === 0 || transports.some((transport) => securityKeyTransports.has(transport));
      });
    } catch {
      return false;
    }
  };

  const refusePasskeyDialogs = (target: typeof globalThis): void => {
    if (!("CredentialsContainer" in target)) return;
    const prototype = target.CredentialsContainer.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "get");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const get = nativeProxy(target, prototype.get, (method, self: unknown, args: [CredentialRequestOptions?]) => {
      if (self instanceof target.CredentialsContainer && opensPasskeyDialog(args[0])) {
        return target.Promise.reject(
          new target.DOMException(
            "The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.",
            "NotAllowedError",
          ),
        );
      }
      try {
        return method.apply(self, args);
      } catch (error) {
        removeTrapFrame(error);
        throw error;
      }
    });
    natives.set(get, "get");
    Object.defineProperty(prototype, "get", { ...descriptor, value: get });
  };

  const refusePrintDialogs = (target: typeof globalThis): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, "print");
    if (!descriptor || typeof descriptor.value !== "function") return;
    const print = nativeProxy(target, descriptor.value, () => undefined);
    natives.set(print, "print");
    Object.defineProperty(target, "print", { ...descriptor, value: print });
  };

  const debugVendor = 0x9245; // WEBGL_debug_renderer_info.UNMASKED_VENDOR_WEBGL
  const debugRenderer = 0x9246; // WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL
  const laptopGpu = {
    [debugVendor]: "Google Inc. (Intel)",
    [debugRenderer]: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
  };
  const replaceSoftwareGpuName = (target: typeof globalThis): void => {
    for (const context of [target.WebGLRenderingContext, target.WebGL2RenderingContext]) {
      const prototype = context?.prototype;
      const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "getParameter");
      if (!descriptor || typeof descriptor.value !== "function") continue;
      const getParameter = nativeProxy(target, prototype.getParameter, (method, self: unknown, args: [number]) => {
        let value: unknown;
        try {
          value = method.apply(self, args);
        } catch (error) {
          removeTrapFrame(error);
          throw error;
        }
        const name = args[0];
        if (typeof value !== "string" || (name !== debugVendor && name !== debugRenderer)) return value;
        const renderer = name === debugRenderer ? value : method.call(self, debugRenderer);
        return typeof renderer === "string" && /SwiftShader/i.test(renderer) ? laptopGpu[name] : value;
      });
      natives.set(getParameter, "getParameter");
      Object.defineProperty(prototype, "getParameter", { ...descriptor, value: getParameter });
    }
  };

  const chromeValues = (target: typeof globalThis) => {
    const performance = target.performance;
    const navigation = (): PerformanceNavigationTiming | undefined => {
      const entry = performance.getEntriesByType("navigation")[0];
      return entry instanceof target.PerformanceNavigationTiming ? entry : undefined;
    };
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
    const maskedToString = nativeProxy(target, functionPrototype.toString, (method, self: unknown) => {
      if (typeof self === "object" && self !== null && nativesRequest in self) {
        Object.defineProperty(self, nativesRequest, { value: natives });
        return "";
      }
      const name = typeof self === "function" ? natives.get(self) : undefined;
      if (name !== undefined) return `function ${name}() { [native code] }`;
      try {
        return method.call(self);
      } catch (error) {
        removeTrapFrame(error);
        throw error;
      }
    });
    natives.set(maskedToString, "toString");
    Object.defineProperty(functionPrototype, "toString", { value: maskedToString });
    if (onMac) refusePasskeyDialogs(target);
    refusePrintDialogs(target);
    if (onLinux) replaceSoftwareGpuName(target);

    const chrome = existing ?? {};
    for (const [key, value] of Object.entries(chromeValues(target))) {
      Object.defineProperty(chrome, key, { value, writable: true, enumerable: true, configurable: true });
    }
    if (chrome !== existing) {
      Object.defineProperty(target, "chrome", { value: chrome, writable: true, enumerable: true, configurable: true });
    }

    const innerSize = (key: "innerWidth" | "innerHeight"): number => {
      try {
        return target.top?.[key] ?? target[key];
      } catch {
        return target[key];
      }
    };
    wrapGetter(target, target, "outerWidth", (value) =>
      value < innerSize("innerWidth") ? innerSize("innerWidth") + frameWidth : value,
    );
    wrapGetter(target, target, "outerHeight", (value) =>
      value <= innerSize("innerHeight") ? innerSize("innerHeight") + toolbarHeight : value,
    );
    for (const key of ["screenX", "screenY", "screenLeft", "screenTop"] as const) {
      wrapGetter(target, target, key, (value) => (value <= -10_000 ? 0 : value));
    }
    wrapGetter(target, target.HTMLIFrameElement.prototype, "contentWindow", (value) => {
      if (isGlobal(value)) {
        try {
          install(value);
        } catch {}
      }
      return value;
    });
  };

  install(globalThis);
}

contextBridge.executeInMainWorld({ func: matchChromePageValues });
