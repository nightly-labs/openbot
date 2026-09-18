import { screen } from "@testing-library/dom";
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AttachmentThumbnail, localAttachmentPreview } from "./attachment-preview";

vi.mock("@/features/workspace/context/mobile-workspace-context", () => ({
  useMobileWorkspace: () => ({ downloadAttachment: vi.fn() }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Alert: { alert: vi.fn() },
}));
vi.mock("heroui-native/hooks", () => ({ useThemeColor: () => "green" }));
vi.mock("lucide-react-native", () => ({ FileText: () => <span>file icon</span> }));
vi.mock("expo-image", () => ({
  Image: ({ accessibilityLabel, source }: { accessibilityLabel: string; source: string }) => (
    <div role="img" aria-label={accessibilityLabel} data-source={source} />
  ),
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: vi.fn() }));
vi.mock("expo-file-system", () => ({ Paths: { cache: "file:///cache" }, File: class {} }));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
}

it("shows the image itself and keeps the file icon for everything else", () => {
  mount(<AttachmentThumbnail name="photo.png" uri="file:///photo.png" />);
  expect(screen.getByRole("img", { name: "photo.png" }).getAttribute("data-source")).toBe("file:///photo.png");
  mount(<AttachmentThumbnail name="report.csv" uri={null} />);
  expect(screen.getByText("file icon")).toBeTruthy();
});

it("previews a file this phone holds only when it is an image", () => {
  expect(localAttachmentPreview({ mimeType: "image/png", base64: "", uri: "file:///added.png" })).toBe(
    "file:///added.png",
  );
  expect(localAttachmentPreview({ mimeType: "image/png", base64: "aGVsbG8=" })).toBe("data:image/png;base64,aGVsbG8=");
  expect(localAttachmentPreview({ mimeType: "text/csv", base64: "aGVsbG8=" })).toBeNull();
});
