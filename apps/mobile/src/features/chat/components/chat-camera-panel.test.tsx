import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, type Ref, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatCameraContent } from "./chat-camera-panel";

const native = vi.hoisted(() => ({
  capture: vi.fn(),
  ready: () => {},
}));
vi.mock("expo-camera", () => ({
  CameraView: ({ ref, onCameraReady }: { ref: Ref<object>; onCameraReady: () => void }) => {
    useImperativeHandle(ref, () => ({ takePictureAsync: native.capture }));
    native.ready = onCameraReady;
    return <div role="img" aria-label="Camera preview" />;
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  StyleSheet: { absoluteFill: {} },
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: PropsWithChildren) => <div>{children}</div> },
  useReducedMotion: () => false,
  cubicBezier: () => "",
}));
vi.mock("lucide-react-native", () => ({ ChevronLeft: () => null, SwitchCamera: () => null }));
vi.mock("heroui-native", () => ({
  Button: ({
    onPress,
    isDisabled,
    accessibilityLabel,
  }: {
    onPress: () => void;
    isDisabled: boolean;
    accessibilityLabel: string;
  }) => <button type="button" onClick={onPress} disabled={isDisabled} aria-label={accessibilityLabel} />,
  Typography: { Paragraph: ({ children }: PropsWithChildren) => <p>{children}</p> },
}));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.resetAllMocks();
});
function mount() {
  const onCaptured = vi.fn<(uri: string) => void>();
  const onCancel = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ChatCameraContent onCaptured={onCaptured} onCancel={onCancel} onBusyChange={() => {}} />));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { onCaptured, onCancel, unmount: () => act(() => root.render(null)) };
}

function shutter() {
  return screen.getByRole<HTMLButtonElement>("button", { name: "Take photo", hidden: true });
}

it("reaches the controls before the camera is ready and holds the shutter", () => {
  mount();
  expect(screen.getByRole("img", { name: "Camera preview", hidden: true })).toBeTruthy();
  // Reachable while the hardware warms up, so leaving does not wait for a preview.
  expect(screen.getByRole("button", { name: "Close camera" })).toBeTruthy();
  expect(shutter().disabled).toBe(true);
  act(() => native.ready());
  expect(shutter().disabled).toBe(false);
});

it("waits for camera readiness and hands the captured photo up", async () => {
  native.capture.mockResolvedValue({ uri: "file:///captured.jpg" });
  const { onCaptured } = mount();
  await act(async () => fireEvent.click(shutter()));
  expect(native.capture).not.toHaveBeenCalled();
  act(() => native.ready());
  await act(async () => fireEvent.click(shutter()));
  // Handed over, not held here: the panel holds it once it has left.
  expect(onCaptured).toHaveBeenCalledWith("file:///captured.jpg");
});

it("waits for the switched camera before capture and cancels without a photo", async () => {
  const { onCancel, onCaptured } = mount();
  act(() => native.ready());
  act(() => fireEvent.click(screen.getByRole("button", { name: "Switch camera" })));
  await act(async () => fireEvent.click(shutter()));
  expect(native.capture).not.toHaveBeenCalled();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Close camera" })));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onCaptured).not.toHaveBeenCalled();
});

it("shows a capture error and permits another attempt", async () => {
  native.capture
    .mockRejectedValueOnce(new Error("Camera interrupted."))
    .mockResolvedValue({ uri: "file:///retry.jpg" });
  const { onCaptured } = mount();
  act(() => native.ready());
  await act(async () => fireEvent.click(shutter()));
  expect(screen.getByText("Camera interrupted.")).toBeTruthy();
  await act(async () => fireEvent.click(shutter()));
  expect(onCaptured).toHaveBeenCalledWith("file:///retry.jpg");
});

it("does not attach a pending capture after the camera is removed", async () => {
  let finish = (_photo: { uri: string }) => {};
  native.capture.mockReturnValue(
    new Promise<{ uri: string }>((resolve) => {
      finish = resolve;
    }),
  );
  const { onCaptured, unmount } = mount();
  act(() => native.ready());
  act(() => fireEvent.click(shutter()));
  unmount();
  await act(async () => finish({ uri: "file:///late.jpg" }));
  expect(onCaptured).not.toHaveBeenCalled();
});
