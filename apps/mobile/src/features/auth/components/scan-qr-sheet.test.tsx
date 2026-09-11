import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScanQrSheet } from "./scan-qr-sheet";

const native = vi.hoisted(() => {
  const camera: { ready?: () => void; scan?: (event: { data: string }) => void } = {};
  return {
    finishMotion: () => {},
    motionStarted: vi.fn(),
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
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
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
  ReduceMotion: { System: "system" },
  cancelAnimation: () => {},
  useSharedValue: (initial: number) => useRef({ get: () => initial, set: () => {} }).current,
  useAnimatedStyle: () => ({}),
  withTiming: (target: number) => target,
  withSpring: (_target: number, _config: { duration: number }, done: (finished: boolean) => void) => {
    native.motionStarted();
    native.finishMotion = () => done(true);
    return 0;
  },
}));
vi.mock("react-native-worklets", () => ({ scheduleOnRN: (callback: () => void) => callback() }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) }));
vi.mock("uniwind", () => ({ useCSSVariable: () => "12" }));
vi.mock("expo-camera", () => ({
  useCameraPermissions: () => [native.permission, native.requestPermission, native.getPermission],
  CameraView: ({
    onBarcodeScanned,
    onCameraReady,
  }: {
    onBarcodeScanned?: (event: { data: string }) => void;
    onCameraReady?: () => void;
  }) => {
    native.camera.scan = onBarcodeScanned;
    native.camera.ready = onCameraReady;
    return <div role="img" aria-label="Camera preview" />;
  },
}));
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
  return {
    Button,
    Typography: Object.assign(Box, { Heading: Box }),
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
  native.motionStarted.mockClear();
  native.permission = { granted: true, canAskAgain: true };
  native.requestPermission.mockClear();
  native.openSettings.mockClear();
});
afterEach(async () => {
  await act(() => root.unmount());
  root = createRoot(container);
});

async function renderSheet(onScan: (data: string) => Promise<void> = async () => {}) {
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
  it("prepares the camera before opening and stops before closing", async () => {
    const { onClose } = await renderSheet();
    expect(screen.getByRole("img", { name: "Camera preview" })).toBeTruthy();
    expect(native.motionStarted).not.toHaveBeenCalled();
    expect(native.camera.scan).toBeUndefined();
    await finishMotion();
    expect(screen.getByRole("img", { name: "Camera preview" })).toBeTruthy();
    expect(native.camera.scan).toBeTypeOf("function");
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Close scanner" })));
    expect(screen.queryByRole("img", { name: "Camera preview" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await finishMotion();
    expect(onClose).toHaveBeenCalledOnce();
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
    await act(() => native.camera.scan?.({ data: "next-code" }));
    expect(onScan).toHaveBeenLastCalledWith("next-code");
    await act(() => fireEvent.click(screen.getByRole("button", { name: "Close scanner" })));
    await finishMotion();
    expect(onClose).toHaveBeenCalledOnce();
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
