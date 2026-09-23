import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatAttachmentView, imageFrame } from "./chat-attachment";

const native = vi.hoisted(() => ({
  photos: vi.fn(),
  imageSource: vi.fn(),
  download: vi.fn(),
  share: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  alert: vi.fn(),
}));
vi.mock("@/features/workspace/context/mobile-workspace-context", () => ({
  useMobileWorkspace: () => ({ downloadAttachment: native.download }),
}));
vi.mock("react-native", () => ({
  View: ({ children, ref }: PropsWithChildren<{ ref?: Ref<unknown> }>) => {
    useImperativeHandle(ref, () => ({
      measureInWindow: (report: (x: number, y: number, width: number, height: number) => void) =>
        report(24, 300, 280, 158),
    }));
    return <div>{children}</div>;
  },
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: PropsWithChildren<{ onPress: () => void; disabled?: boolean; accessibilityLabel?: string }>) => (
    <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  Alert: { alert: native.alert },
  useWindowDimensions: () => ({ width: 390 }),
  Platform: { OS: "ios" },
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => ["green", "gray"] }));
vi.mock("lucide-react-native", () => ({ ExternalLink: () => null, ImageOff: () => null }));
vi.mock("react-native-reanimated", () => ({
  default: {
    View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  },
  cubicBezier: () => "ease",
  useReducedMotion: () => false,
}));
vi.mock("./upload-progress", () => ({
  UPLOAD_BLUR_RADIUS: 24,
  UPLOAD_SETTLE_MS: 400,
  useUploadRevealStyle: () => ({}),
  UploadProgressCircle: ({ progress }: { progress: number }) => (
    <span
      role="progressbar"
      aria-label={progress >= 1 ? "Uploaded" : "Uploading"}
      aria-valuenow={Math.round(progress * 100)}
    />
  ),
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
    source,
    onLoad,
  }: {
    accessibilityLabel: string;
    source: string | null;
    onLoad?: (event: { source: { width: number; height: number } }) => void;
  }) => {
    native.imageSource(source);
    // A real image reports one load for each source it draws.
    const loaded = useRef<string | null>(null);
    useEffect(() => {
      if (!source || loaded.current === source) return;
      loaded.current = source;
      onLoad?.({ source: { width: 4, height: 3 } });
    });
    return source ? <div role="img" aria-label={accessibilityLabel} /> : null;
  },
}));
vi.mock("expo-media-library", () => ({
  requestPermissionsAsync: async () => ({ granted: true }),
  Asset: { create: native.photos },
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: native.share }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri: string;
    exists = true;
    constructor(directory: string, name: string) {
      this.uri = `${directory}/${name}`;
    }
    write = native.write;
    delete = native.remove;
  },
}));
vi.mock("heroui-native", () => {
  const Label = ({ children }: PropsWithChildren) => <span>{children}</span>;
  const Button = Object.assign(
    ({
      children,
      onPress,
      isDisabled,
      accessibilityLabel,
    }: PropsWithChildren<{ onPress: () => void; isDisabled?: boolean; accessibilityLabel?: string }>) => (
      <button type="button" aria-label={accessibilityLabel} disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    ),
    { Label },
  );
  const Skeleton = ({ isLoading, accessibilityLabel }: { isLoading: boolean; accessibilityLabel?: string }) =>
    isLoading ? <span role="img" aria-label={accessibilityLabel} /> : null;
  return { Button, Skeleton, Typography: { Paragraph: Label } };
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.resetAllMocks();
});
function mount(
  attachment: AttachmentSummary,
  cached?: { name: string; mimeType: string; base64: string; localUri?: string },
  upload?: number,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(["chat-attachment", "selected-host", attachment.id], cached);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ChatAttachmentView attachment={attachment} serverId="selected-host" upload={upload} />
      </QueryClientProvider>,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
  });
}
const attachment: AttachmentSummary = {
  id: "stored-file",
  name: "data.csv",
  kind: "file",
  mimeType: "text/plain",
  size: 5,
  previewKind: "none",
  previewUrl: null,
};

it("opens a file when its filename is tapped and removes the temporary share file", async () => {
  native.download.mockResolvedValue({ name: "data.csv", mimeType: "text/plain", base64: btoa("hello") });
  mount(attachment);
  expect(native.download).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByText("data.csv"));
  });
  await waitFor(() =>
    expect(native.share).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/\d+-data\.csv$/u), {
      mimeType: "text/plain",
      dialogTitle: "data.csv",
    }),
  );
  expect(native.download).toHaveBeenCalledWith("selected-host", "stored-file");
  expect(native.write).toHaveBeenCalledWith(btoa("hello"), { encoding: "base64" });
  expect(native.remove).toHaveBeenCalledOnce();
});

it("retries a failed image download from the correct host and displays the image", async () => {
  native.download
    .mockRejectedValueOnce(new Error("The host is offline."))
    .mockResolvedValue({ name: "photo.png", mimeType: "image/png", base64: "aGVsbG8=" });
  mount({ ...attachment, name: "photo.png", mimeType: "image/png", kind: "image" });
  await waitFor(() => expect(screen.getByText("The host is offline.")).toBeTruthy());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry image" }));
  });
  await waitFor(() => expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy());
  expect(native.download).toHaveBeenLastCalledWith("selected-host", "stored-file");
});

it("opens a message image from its place in the chat, then shares it and saves it to Photos", async () => {
  native.download.mockResolvedValue({ name: "photo.png", mimeType: "image/png", base64: "aGVsbG8=" });
  mount({ ...attachment, name: "photo.png", mimeType: "image/png", kind: "image" });
  await waitFor(() => expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));
  });
  expect(screen.getByRole("dialog", { name: "photo.png" }).getAttribute("data-origin")).toBe("24,300");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
  });
  await waitFor(() =>
    expect(native.share).toHaveBeenCalledWith(expect.any(String), { mimeType: "image/png", dialogTitle: "photo.png" }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save to Photos" }));
  });
  // The photo library reads the type from the extension of the file it receives.
  await waitFor(() => expect(native.photos).toHaveBeenCalledWith(expect.stringMatching(/-download\.png$/u)));
  expect(native.alert).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows every image whole: tall ones at one height, wide ones scaled to the column", () => {
  const frames = [
    imageFrame(null, 280),
    imageFrame({ width: 3024, height: 4032 }, 280),
    imageFrame({ width: 1170, height: 2532 }, 280),
    imageFrame({ width: 1600, height: 900 }, 280),
    imageFrame({ width: 4000, height: 1000 }, 280),
    imageFrame({ width: 100, height: 1000 }, 280),
  ];
  expect(frames).toEqual([
    // Unknown, portrait, and screenshot: the same height, so loading never moves the chat.
    { width: 180, height: 240 },
    { width: 180, height: 240 },
    { width: 111, height: 240 },
    // Too wide for the column at that height: scaled down whole, not cropped.
    { width: 280, height: 158 },
    { width: 280, height: 70 },
    // Extremely narrow: a frame wide enough to tap, with the image whole inside it.
    { width: 72, height: 240 },
  ]);
});

it("names a file's type and size, and sends a file above the mobile limit to desktop", () => {
  mount({ ...attachment, name: "report.pdf", mimeType: "application/pdf", size: 2 * 1024 * 1024 });
  expect(screen.getByText("PDF · 2.0 MB")).toBeTruthy();
  mount({ ...attachment, id: "large", name: "scan.png", kind: "image", mimeType: "image/png", size: 11 * 1024 * 1024 });
  expect(screen.getByRole("button", { name: "Open or save scan.png" })).toHaveProperty("disabled", true);
  expect(screen.getByText("11.0 MB · Open it on desktop")).toBeTruthy();
  expect(native.download).not.toHaveBeenCalled();
});

it("shows how much of a sending file has uploaded, in its text and beside it", () => {
  mount({ ...attachment, id: "mobile-draft-attachment-1", name: "notes.txt" }, undefined, 0.43);
  expect(screen.getByText("Uploading · 43%")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Uploading" }).getAttribute("aria-valuenow")).toBe("43");
});

it("shows a skeleton while an image from the chat downloads, and nothing behind it once shown", async () => {
  let finish: (value: { name: string; mimeType: string; base64: string }) => void = () => {};
  native.download.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  mount({ ...attachment, name: "photo.png", mimeType: "image/png", kind: "image" });
  await waitFor(() => expect(native.download).toHaveBeenCalled());
  expect(screen.getByRole("img", { name: "Loading image" })).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  await act(async () => finish({ name: "photo.png", mimeType: "image/png", base64: "aGVsbG8=" }));
  await waitFor(() => expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy());
  await waitFor(() => expect(screen.queryByRole("img", { name: "Loading image" })).toBeNull());
});

it("uses the uploaded local image under its host ID without downloading it again", async () => {
  mount(
    { ...attachment, name: "photo.png", mimeType: "image/png", kind: "image" },
    { name: "photo.png", mimeType: "image/png", base64: "aGVsbG8=", localUri: "file:///photo.png" },
  );
  expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
  });
  expect(native.download).not.toHaveBeenCalled();
  expect(native.imageSource).toHaveBeenLastCalledWith("file:///photo.png");
  expect(native.write).toHaveBeenCalledWith("aGVsbG8=", { encoding: "base64" });
});

it("renders the device file while its message is still pending", () => {
  mount({
    ...attachment,
    id: "mobile-draft-attachment-1",
    name: "pending.png",
    mimeType: "image/png",
    kind: "image",
    previewUrl: "file:///pending.png",
  });
  expect(native.imageSource).toHaveBeenLastCalledWith("file:///pending.png");
  expect(native.download).not.toHaveBeenCalled();
});
