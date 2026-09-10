import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatAttachmentView } from "./chat-attachment";

const native = vi.hoisted(() => ({
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
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Alert: { alert: native.alert },
  useWindowDimensions: () => ({ width: 390 }),
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => ["green", "gray"] }));
vi.mock("lucide-react-native", () => ({ ExternalLink: () => null, FileText: () => null }));
vi.mock("expo-image", () => ({
  Image: ({ accessibilityLabel }: { accessibilityLabel: string }) => <div role="img" aria-label={accessibilityLabel} />,
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
  return { Button, Typography: { Paragraph: Label } };
});
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.resetAllMocks();
});
function mount(attachment: AttachmentSummary) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ChatAttachmentView attachment={attachment} serverId="selected-host" />
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

it("opens the share sheet when the user taps a message image", async () => {
  native.download.mockResolvedValue({ name: "photo.png", mimeType: "image/png", base64: "aGVsbG8=" });
  mount({ ...attachment, name: "photo.png", mimeType: "image/png", kind: "image" });
  await waitFor(() => expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy());
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open or save photo.png" }));
  });
  await waitFor(() =>
    expect(native.share).toHaveBeenCalledWith(expect.any(String), { mimeType: "image/png", dialogTitle: "photo.png" }),
  );
  expect(native.write).toHaveBeenCalledWith("aGVsbG8=", { encoding: "base64" });
});
