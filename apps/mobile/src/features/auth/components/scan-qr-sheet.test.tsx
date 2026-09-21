import { fireEvent, screen } from "@testing-library/dom";
import {
  act,
  createContext,
  type PropsWithChildren,
  type Ref,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPLASH_HANDOFF_DEADLINE_MS, SplashContentReadyContext } from "@/shared/lib/use-splash-gate";
import { SignInScreen } from "../screens/sign-in-screen";
import { ScanQrSheet } from "./scan-qr-sheet";

const native = vi.hoisted(() => {
  const camera: { ready?: () => void; fail?: () => void; scan?: (event: { data: string }) => void } = {};
  return {
    measurementAvailable: true,
    reducedMotion: false,
    layout: new Set<(event: { nativeEvent: { layout: { width: number; height: number } } }) => void>(),
    finishMotion: () => {},
    motionStarted: vi.fn(),
    cameraStarted: vi.fn(),
    back: new Set<() => boolean>(),
    appState: new Set<(state: string) => void>(),
    permission: { granted: true, canAskAgain: true },
    requestPermission: vi.fn(),
    getPermission: vi.fn(),
    openSettings: vi.fn(),
    camera,
  };
});

// Native camera, permission, animation and input APIs have no DOM implementation.
// Keep the scanner and sheet real; complete motion through its callback, not a timer.
vi.mock("@/shared/lib/haptics", () => ({ haptics: { impact: vi.fn(async () => {}) } }));
vi.mock("react-native", () => ({
  View: ({
    children,
    onLayout,
    ref,
    style,
  }: PropsWithChildren<{
    ref?: Ref<{ measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void }>;
    style?: { width?: number; height?: number };
    onLayout?: (event: { nativeEvent: { layout: { width: number; height: number } } }) => void;
  }>) => {
    useImperativeHandle(
      ref,
      () => ({
        measureInWindow: (callback) => {
          if (!native.measurementAvailable) return;
          const width = style?.width ?? 390;
          callback((390 - width) / 2, style?.height === 72 ? 228 : 0, width, style?.height ?? 844);
        },
      }),
      [style],
    );
    useEffect(() => {
      if (!onLayout) return;
      native.layout.add(onLayout);
      return () => {
        native.layout.delete(onLayout);
      };
    }, [onLayout]);
    return <div>{children}</div>;
  },
  ScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Pressable: () => null,
  StyleSheet: { absoluteFill: {} },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  Linking: { openSettings: native.openSettings },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, callback: (state: string) => void) => {
      native.appState.add(callback);
      return { remove: () => native.appState.delete(callback) };
    },
  },
  BackHandler: {
    addEventListener: (_event: string, callback: () => boolean) => {
      native.back.add(callback);
      return { remove: () => native.back.delete(callback) };
    },
  },
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: PropsWithChildren) => <div>{children}</div> },
  ReduceMotion: { System: "system", Never: "never" },
  Easing: { bezier: () => ({ factory: () => (value: number) => value }), linear: (value: number) => value },
  withDelay: (_delay: number, animation: number) => animation,
  cancelAnimation: () => {},
  useSharedValue: (initial: number) => useRef({ get: () => initial, set: () => {} }).current,
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => native.reducedMotion,
  withTiming: (target: number, _config: { duration: number }, done?: (finished: boolean) => void) => {
    if (!done) return target;
    native.motionStarted();
    native.finishMotion = () => done(true);
    return 0;
  },
}));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: (run: number) => void, run: number) => callback(run),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
vi.mock("uniwind", () => ({ useCSSVariable: () => "12" }));
vi.mock("expo-blur", () => ({
  BlurTargetView: ({ children }: PropsWithChildren) => <div>{children}</div>,
  BlurView: () => null,
}));
vi.mock("expo-camera", () => ({
  useCameraPermissions: () => [native.permission, native.requestPermission, native.getPermission],
  CameraView: ({
    onBarcodeScanned,
    onCameraReady,
    onMountError,
  }: {
    onBarcodeScanned?: (event: { data: string }) => void;
    onCameraReady?: () => void;
    onMountError?: () => void;
  }) => {
    useEffect(() => {
      native.cameraStarted();
    }, []);
    native.camera.fail = onMountError;
    native.camera.scan = onBarcodeScanned;
    native.camera.ready = onCameraReady;
    return <div role="img" aria-label="Camera preview" />;
  },
}));
// Sign-in imports native storage and artwork with no DOM implementation or injectable seam.
vi.mock("@/features/auth/api/mobile-auth", () => ({ redeemMobileConnectUrl: vi.fn() }));
vi.mock("@/features/auth/context/mobile-session-context", () => ({ useMobileSession: () => ({ connect: vi.fn() }) }));
vi.mock("@/features/auth/components/app-logo", () => ({ AppLogo: () => null }));
vi.mock("@/shared/components/splash-backdrop", () => ({ SplashWallpaper: () => null }));
vi.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
vi.mock("expo-router/react-navigation", () => ({ useIsFocused: () => true }));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("lucide-react-native", () => ({ Camera: () => null, ScanLine: () => null, X: () => null }));
vi.mock("heroui-native/hooks", () => ({
  useThemeColor: (name: string | string[]) => (Array.isArray(name) ? ["black", "white"] : "black"),
}));
vi.mock("heroui-native", () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Button = Object.assign(
    ({
      children,
      onPress,
      isDisabled,
      accessibilityLabel,
    }: PropsWithChildren<{
      onPress: () => void;
      isDisabled?: boolean;
      accessibilityLabel?: string;
    }>) => (
      <button type="button" disabled={isDisabled} aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
    { Label: Box },
  );
  const Disclosure = createContext({ expanded: false, toggle: () => {} });
  const Accordion = Object.assign(
    ({ children }: PropsWithChildren) => {
      const [expanded, setExpanded] = useState(false);
      return (
        <Disclosure.Provider value={{ expanded, toggle: () => setExpanded((value) => !value) }}>
          {children}
        </Disclosure.Provider>
      );
    },
    {
      Item: Box,
      Trigger: ({ children }: PropsWithChildren) => {
        const { expanded, toggle } = useContext(Disclosure);
        return (
          <button type="button" aria-expanded={expanded} onClick={toggle}>
            {children}
          </button>
        );
      },
      Content: ({ children }: PropsWithChildren) => (useContext(Disclosure).expanded ? <div>{children}</div> : null),
      Indicator: () => null,
    },
  );
  return {
    Accordion,
    Button,
    Typography: Object.assign(Box, { Heading: Box, Paragraph: Box }),
    Card: Object.assign(Box, { Body: Box, Title: Box, Description: Box, Header: Box, Footer: Box }),
    Alert: Object.assign(Box, { Indicator: Box, Content: Box, Title: Box, Description: Box }),
    Surface: Box,
    Spinner: () => <div role="status">Loading camera</div>,
  };
});

const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
beforeEach(() => {
  native.measurementAvailable = true;
  native.reducedMotion = false;
  native.motionStarted.mockClear();
  native.cameraStarted.mockClear();
  native.permission = { granted: true, canAskAgain: true };
  native.requestPermission.mockClear();
  native.openSettings.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
  vi.useRealTimers();
});

async function renderSheet(
  onScan: (data: string, beforeConnect: () => Promise<void>) => Promise<void> = async () => {},
) {
  const onClose = vi.fn();
  await act(() =>
    root.render(
      <ScanQrSheet
        origin={{ x: 75, y: 500, width: 240, height: 52 }}
        viewport={{ width: 390, height: 844 }}
        onClose={onClose}
        onScan={onScan}
      />,
    ),
  );
  return { onClose };
}

async function finishMotion() {
  await act(() => native.camera.ready?.());
  await act(() => native.finishMotion());
}

describe("scanner sheet lifecycle", () => {
  it("shows the desktop QR path and phone instructions whenever sign-in is reopened", async () => {
    for (let visit = 0; visit < 2; visit++) {
      const ready = vi.fn();
      await act(() =>
        root.render(
          <SplashContentReadyContext.Provider value={ready}>
            <SignInScreen />
          </SplashContentReadyContext.Provider>,
        ),
      );
      expect(ready).not.toHaveBeenCalled();
      await act(() => {
        for (const layout of native.layout) layout({ nativeEvent: { layout: { width: 390, height: 844 } } });
      });
      expect(ready).toHaveBeenCalledWith({ x: 159, y: 228, size: 72 });
      expect(screen.getByText("Your agents, anywhere.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Scan QR code" })).toBeTruthy();
      expect(screen.queryByText("2. Go to Settings → Mobile Connect.")).toBeNull();
      await act(() => fireEvent.click(screen.getByRole("button", { name: "Where is the QR code?" })));
      expect(screen.getByText("1. Open OpenBot on your computer.")).toBeTruthy();
      expect(screen.getByText("2. Go to Settings → Mobile Connect.")).toBeTruthy();
      expect(screen.getByText("3. Choose Generate QR code, then scan it here.")).toBeTruthy();
      await act(() => fireEvent.click(screen.getByRole("button", { name: "Where is the QR code?" })));
      expect(screen.queryByText("2. Go to Settings → Mobile Connect.")).toBeNull();
      await act(() => root.render(null));
    }
  });

  it("permits the fallback fade when native logo measurement does not report", async () => {
    vi.useFakeTimers();
    native.measurementAvailable = false;
    const ready = vi.fn();
    await act(() =>
      root.render(
        <SplashContentReadyContext.Provider value={ready}>
          <SignInScreen />
        </SplashContentReadyContext.Provider>,
      ),
    );
    await act(() => {
      for (const layout of native.layout) layout({ nativeEvent: { layout: { width: 390, height: 844 } } });
    });
    expect(ready).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(SPLASH_HANDOFF_DEADLINE_MS));
    expect(ready).toHaveBeenCalledWith();
    expect(screen.getByRole("button", { name: "Scan QR code" })).toBeTruthy();
  });

  it("prepares the camera before opening and blocks scans while fading out", async () => {
    const onScan = vi.fn(async () => {});
    const { onClose } = await renderSheet(onScan);
    expect(screen.getByRole("img", { name: "Camera preview" })).toBeTruthy();
    expect(native.motionStarted).not.toHaveBeenCalled();
    expect(native.camera.scan).toBeTypeOf("function");
    await act(() => native.camera.scan?.({ data: "code-during-opening" }));
    expect(onScan).not.toHaveBeenCalled();
    await finishMotion();
    expect(screen.getByRole("img", { name: "Camera preview" })).toBeTruthy();
    expect(native.camera.scan).toBeTypeOf("function");
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Close scanner" })));
    expect(screen.getByRole("img", { name: "Camera preview" })).toBeTruthy();
    await act(() => native.camera.scan?.({ data: "code-during-closing" }));
    expect(onScan).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await finishMotion();
    expect(screen.queryByRole("img", { name: "Camera preview" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([false, true])("keeps an interrupted opening closed (reduced motion: %s)", async (reducedMotion) => {
    native.reducedMotion = reducedMotion;
    const onScan = vi.fn(async () => {});
    const { onClose } = await renderSheet(onScan);
    await act(() => native.camera.ready?.());
    const finishOpening = native.finishMotion;
    await act(() => {
      for (const back of native.back) back();
    });
    const finishClosing = native.finishMotion;
    await act(() => finishOpening());
    await act(() => native.camera.scan?.({ data: "code-after-cancel" }));
    expect(onScan).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(() => finishClosing());
    expect(screen.queryByRole("img", { name: "Camera preview" })).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("attaches the session after the successful scanner exit", async () => {
    const attach = vi.fn();
    const { onClose } = await renderSheet(async (_data, beforeConnect) => {
      await beforeConnect();
      attach();
    });
    await finishMotion();
    await act(() => native.camera.scan?.({ data: "paired-code" }));
    expect(attach).not.toHaveBeenCalled();
    await act(() => {
      for (const back of native.back) back();
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(() => native.finishMotion());
    expect(attach).toHaveBeenCalledOnce();
  });

  it("attaches a redeemed session if the native exit callback is lost", async () => {
    vi.useFakeTimers();
    const attach = vi.fn();
    await renderSheet(async (_data, beforeConnect) => {
      await beforeConnect();
      attach();
    });
    await finishMotion();
    await act(() => native.camera.scan?.({ data: "paired-code" }));
    expect(attach).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTime(1000));
    expect(attach).toHaveBeenCalledOnce();
  });

  it("does not strand a redeemed session when the app backgrounds during its exit", async () => {
    const attach = vi.fn();
    await renderSheet(async (_data, beforeConnect) => {
      await beforeConnect();
      attach();
    });
    await finishMotion();
    await act(() => native.camera.scan?.({ data: "paired-code" }));
    await act(() => {
      for (const listener of native.appState) listener("background");
    });
    expect(attach).toHaveBeenCalledOnce();
    await act(() => native.finishMotion());
    expect(attach).toHaveBeenCalledOnce();
  });

  it("releases the camera in the background and resumes it on return", async () => {
    await renderSheet();
    await finishMotion();
    await act(() => {
      for (const listener of native.appState) listener("background");
    });
    expect(screen.queryByRole("img", { name: "Camera preview" })).toBeNull();
    await act(() => {
      for (const listener of native.appState) listener("active");
    });
    expect(screen.getByRole("img", { name: "Camera preview" })).toBeTruthy();
  });

  it("keeps redemption single-flight and blocks dismissal until an error permits retry", async () => {
    let rejectScan: (error: Error) => void = () => {};
    const pending = new Promise<void>((_resolve, reject) => {
      rejectScan = reject;
    });
    const onScan = vi.fn(() => pending);
    const { onClose } = await renderSheet(onScan);
    await finishMotion();
    const scan = native.camera.scan;
    await act(() => {
      scan?.({ data: "test-code" });
      scan?.({ data: "test-code" });
    });
    expect(onScan).toHaveBeenCalledTimes(1);
    await act(() => {
      for (const listener of native.back) listener();
    });
    expect(screen.getByRole("img", { name: "Camera preview" })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await act(() => rejectScan(new Error("Code expired")));
    expect(screen.getByText("Code expired")).toBeTruthy();
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Scan again" })));
    expect(native.cameraStarted).toHaveBeenCalledTimes(1);
    await act(() => native.camera.scan?.({ data: "next-code" }));
    expect(onScan).toHaveBeenLastCalledWith("next-code", expect.any(Function));
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Close scanner" })));
    await finishMotion();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("restarts the camera when retrying a camera startup failure", async () => {
    await renderSheet();
    await act(() => native.camera.fail?.());
    await finishMotion();
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Scan again" })));
    expect(native.cameraStarted).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("handles camera permission with canAskAgain=%s", async (canAskAgain) => {
    native.permission = { granted: false, canAskAgain };
    await renderSheet();
    await finishMotion();
    expect(screen.queryByRole("img", { name: "Camera preview" })).toBeNull();
    await act(() =>
      fireEvent.click(screen.getByRole("button", { name: canAskAgain ? "Allow camera access" : "Open settings" })),
    );
    expect(canAskAgain ? native.requestPermission : native.openSettings).toHaveBeenCalledOnce();
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Close scanner" })));
    await finishMotion();
  });
});
