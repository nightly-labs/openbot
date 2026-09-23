import type { AttachmentSummary, ImageGenerationInfo } from "@openbot/contracts/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatImageGeneration, type ImageGenerationStatus, imageGenerationStatus } from "./chat-image-generation";

const native = vi.hoisted(() => ({ download: vi.fn(), share: vi.fn(), canvas: vi.fn() }));
vi.mock("@/features/workspace/context/mobile-workspace-context", () => ({
  useMobileWorkspace: () => ({ downloadAttachment: native.download }),
}));
type NativeProps = PropsWithChildren<{
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessible?: boolean;
  ref?: Ref<unknown>;
}>;
vi.mock("react-native", () => ({
  View: ({ children, accessibilityLabel, accessibilityRole, accessible, ref }: NativeProps) => {
    useImperativeHandle(ref, () => ({
      measureInWindow: (report: (x: number, y: number, width: number, height: number) => void) =>
        report(16, 200, 300, 300),
    }));
    return accessible !== false && accessibilityRole === "image" ? (
      <div role="img" aria-label={accessibilityLabel}>
        {children}
      </div>
    ) : (
      <div>{children}</div>
    );
  },
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: PropsWithChildren<{ onPress: () => void; accessibilityLabel?: string }>) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  Alert: { alert: vi.fn() },
  Platform: { OS: "ios" },
  useWindowDimensions: () => ({ width: 390 }),
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: PropsWithChildren) => <div>{children}</div> },
  Easing: { bezier: () => "ease" },
  ReduceMotion: { Never: "never" },
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => false,
  useSharedValue: () => ({ set: () => {} }),
  // The reveal is visual; finishing it at once leaves the state it ends in.
  withTiming: (value: number, _config: unknown, done?: (finished: boolean) => void) => {
    done?.(true);
    return value;
  },
}));
vi.mock("react-native-worklets", () => ({
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
}));
vi.mock("react-native-svg", () => ({
  default: () => null,
  Defs: () => null,
  RadialGradient: () => null,
  Rect: () => null,
  Stop: () => null,
}));
vi.mock("@react-native-masked-view/masked-view", () => ({
  default: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("./image-generation-canvas", () => ({
  ImageGenerationCanvas: (props: { running: boolean; failed: boolean }) => {
    native.canvas(props);
    return null;
  },
}));
vi.mock("./image-viewer", () => ({
  ImageViewer: ({
    name,
    measureOrigin,
    onShare,
    onSave,
    onDismissed,
  }: {
    name: string;
    measureOrigin: (report: (rect: { x: number; y: number } | null) => void) => void;
    onShare: () => void;
    onSave: () => Promise<boolean>;
    onDismissed: () => void;
  }) => {
    const [origin, setOrigin] = useState("");
    useEffect(() => measureOrigin((rect) => setOrigin(rect ? `${rect.x},${rect.y}` : "none")), [measureOrigin]);
    return (
      <div role="dialog" aria-label={name} data-origin={origin}>
        <button type="button" onClick={onShare}>
          Share
        </button>
        <button type="button" onClick={() => void onSave()}>
          Save to Photos
        </button>
        <button type="button" onClick={onDismissed}>
          Close
        </button>
      </div>
    );
  },
}));
vi.mock("expo-image", () => ({
  Image: ({
    accessibilityLabel,
    onLoad,
  }: {
    accessibilityLabel: string;
    onLoad: (event: { source: { width: number; height: number } }) => void;
  }) => {
    // A real image reports its load once per source.
    const reported = useRef(false);
    useEffect(() => {
      if (reported.current) return;
      reported.current = true;
      onLoad({ source: { width: 1024, height: 1024 } });
    });
    return <div role="img" aria-label={accessibilityLabel} />;
  },
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: native.share }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri = "file:///cache/image.png";
    exists = false;
    write() {}
    delete() {}
  },
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => ["gray", "violet", "white", "gray"] }));
vi.mock("lucide-react-native", () => ({ X: () => null }));
vi.mock("heroui-native", () => {
  const Label = ({ children, accessibilityRole }: PropsWithChildren<{ accessibilityRole?: string }>) => (
    <span role={accessibilityRole}>{children}</span>
  );
  const Button = Object.assign(
    ({
      children,
      onPress,
      accessibilityLabel,
    }: PropsWithChildren<{ onPress: () => void; accessibilityLabel?: string }>) => (
      <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
    { Label },
  );
  return { Button, Typography: { Paragraph: Label } };
});

const generation: ImageGenerationInfo = {
  prompt: "A lighthouse at dusk",
  resolution: "1024×1024",
  aspectRatio: "square",
};
const image: AttachmentSummary = {
  id: "generated-image",
  name: "lighthouse.png",
  size: 1200,
  kind: "image",
  mimeType: "image/png",
  previewKind: "image",
  previewUrl: null,
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.resetAllMocks();
});
function mount(status: ImageGenerationStatus, attachment?: AttachmentSummary, info = generation) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (next: ImageGenerationStatus, file = attachment) =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <ChatImageGeneration generation={info} status={next} attachment={file} serverId="image-host" />
        </QueryClientProvider>,
      ),
    );
  render(status);
  cleanups.push(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });
  return render;
}

describe("generated image in the mobile chat", () => {
  it("maps message state to the generation state the way desktop does", () => {
    expect(imageGenerationStatus(true, "completed")).toBe("generating");
    expect(imageGenerationStatus(false, "streaming")).toBe("generating");
    expect(imageGenerationStatus(false, "failed")).toBe("failed");
    expect(imageGenerationStatus(false, "interrupted")).toBe("interrupted");
    expect(imageGenerationStatus(false, "completed")).toBe("completed");
  });

  it("shows the running placeholder with the prompt and size while the image is generated", () => {
    mount("generating");
    expect(screen.getByRole("img", { name: "Generating image" })).toBeTruthy();
    expect(screen.getByText("“A lighthouse at dusk”")).toBeTruthy();
    expect(screen.getByText("1024×1024")).toBeTruthy();
    expect(native.canvas).toHaveBeenLastCalledWith(expect.objectContaining({ running: true, failed: false }));
    expect(native.download).not.toHaveBeenCalled();
  });

  it("reveals the finished image from its own host in the same message, then previews and shares it", async () => {
    native.download.mockResolvedValue({ name: "lighthouse.png", mimeType: "image/png", base64: "aGVsbG8=" });
    const render = mount("generating");
    render("completed", image);
    await waitFor(() => expect(screen.getByRole("img", { name: "A lighthouse at dusk" })).toBeTruthy());
    expect(native.download).toHaveBeenCalledWith("image-host", "generated-image");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview generated image" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });
    await waitFor(() =>
      expect(native.share).toHaveBeenCalledWith(expect.any(String), {
        mimeType: "image/png",
        dialogTitle: "lighthouse.png",
      }),
    );
  });

  it("explains a failed and an interrupted generation with the host's reason or a default", () => {
    mount("failed", undefined, { ...generation, error: "The provider refused the prompt." });
    expect(screen.getByRole("img", { name: "Image generation failed" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("The provider refused the prompt.");
    expect(native.canvas).toHaveBeenLastCalledWith(expect.objectContaining({ running: false, failed: true }));
    for (const cleanup of cleanups.splice(0)) cleanup();
    mount("interrupted");
    expect(screen.getByRole("img", { name: "Image generation interrupted" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Image generation was interrupted.");
  });

  it("reports a missing image, and retries a failed download until the image shows", async () => {
    mount("completed");
    expect(screen.getByRole("img", { name: "Image unavailable" })).toBeTruthy();
    for (const cleanup of cleanups.splice(0)) cleanup();
    native.download
      .mockRejectedValueOnce(new Error("The host is offline."))
      .mockResolvedValue({ name: "lighthouse.png", mimeType: "image/png", base64: "aGVsbG8=" });
    mount("completed", image);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The host is offline."));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry image" }));
    });
    await waitFor(() => expect(screen.getByRole("img", { name: "A lighthouse at dusk" })).toBeTruthy());
  });
});
