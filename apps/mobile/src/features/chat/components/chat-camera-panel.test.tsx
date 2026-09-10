import { fireEvent, screen } from "@testing-library/dom";
import { act, type PropsWithChildren, type Ref, useImperativeHandle } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatCameraPanel } from "./chat-camera-panel";

const native = vi.hoisted(() => ({
  capture: vi.fn(),
  ready: () => {},
}));
vi.mock("expo-camera", () => ({
  CameraView: ({ ref, onCameraReady }: { ref: Ref<object>; onCameraReady: () => void }) => {
    useImperativeHandle(ref, () => ({ takePictureAsync: native.capture }));
    native.ready = onCameraReady;
    return null;
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Pressable: () => null,
  StyleSheet: { absoluteFill: {} },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34 }),
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: PropsWithChildren) => <div>{children}</div> },
  FadeInUp: { duration: () => ({ reduceMotion: () => ({}) }) },
  ReduceMotion: { System: "system" },
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
  const onPhoto = vi.fn<(uri: string) => Promise<void>>().mockResolvedValue();
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<ChatCameraPanel onPhoto={onPhoto} onClose={onClose} />));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { onPhoto, onClose, unmount: () => act(() => root.render(null)) };
}

it("waits for camera readiness and attaches the captured photo", async () => {
  native.capture.mockResolvedValue({ uri: "file:///captured.jpg" });
  const { onPhoto } = mount();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take photo" })));
  expect(native.capture).not.toHaveBeenCalled();
  act(() => native.ready());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take photo" })));
  expect(onPhoto).toHaveBeenCalledWith("file:///captured.jpg");
});

it("waits for the switched camera before capture and closes without a photo", async () => {
  const { onClose, onPhoto } = mount();
  act(() => native.ready());
  act(() => fireEvent.click(screen.getByRole("button", { name: "Switch camera" })));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take photo" })));
  expect(native.capture).not.toHaveBeenCalled();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Close camera" })));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onPhoto).not.toHaveBeenCalled();
});

it("shows a capture error and permits another attempt", async () => {
  native.capture
    .mockRejectedValueOnce(new Error("Camera interrupted."))
    .mockResolvedValue({ uri: "file:///retry.jpg" });
  const { onPhoto } = mount();
  act(() => native.ready());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take photo" })));
  expect(screen.getByText("Camera interrupted.")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Take photo" })));
  expect(onPhoto).toHaveBeenCalledWith("file:///retry.jpg");
});

it("does not attach a pending capture after the camera is removed", async () => {
  let finish = (_photo: { uri: string }) => {};
  native.capture.mockReturnValue(
    new Promise<{ uri: string }>((resolve) => {
      finish = resolve;
    }),
  );
  const { onPhoto, unmount } = mount();
  act(() => native.ready());
  act(() => fireEvent.click(screen.getByRole("button", { name: "Take photo" })));
  unmount();
  await act(async () => finish({ uri: "file:///late.jpg" }));
  expect(onPhoto).not.toHaveBeenCalled();
});
