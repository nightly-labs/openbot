import { ATTACHMENT_FILE_EXTENSIONS, attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatAttachments } from "./use-chat-attachments";

const native = vi.hoisted(() => ({
  documents: vi.fn(),
  camera: vi.fn(),
  photos: vi.fn(),
  permission: vi.fn(),
  alert: vi.fn(),
  size: 5,
}));
vi.mock("react-native", () => ({ Alert: { alert: native.alert }, Keyboard: { dismiss: () => {} } }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: native.documents }));
vi.mock("expo-image-picker", () => ({
  launchCameraAsync: native.camera,
  launchImageLibraryAsync: native.photos,
  requestCameraPermissionsAsync: native.permission,
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    size = native.size;
    async base64() {
      return btoa("hello");
    }
  },
}));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  native.size = 5;
  vi.clearAllMocks();
});
function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  let attachments: ReturnType<typeof useChatAttachments> | null = null;
  function Harness() {
    attachments = useChatAttachments();
    return null;
  }
  act(() => root.render(<Harness />));
  cleanups.push(() => act(() => root.unmount()));
  return () => {
    if (!attachments) throw new Error("Hook did not mount");
    return attachments;
  };
}

describe("mobile attachment selection", () => {
  it("accepts the shared desktop formats, including extensionless text files, in selection order", async () => {
    const state = mount();
    const names = [...ATTACHMENT_FILE_EXTENSIONS.map((extension) => `file.${extension}`), "Dockerfile", ".env"];
    for (let index = 0; index < names.length; index += 10) {
      const batch = names.slice(index, index + 10);
      native.documents.mockResolvedValue({
        canceled: false,
        assets: batch.map((name) => ({ name, uri: `file:///${name}` })),
      });
      await act(async () => {
        await state().chooseFiles();
      });
      expect(state().items.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 }))).toEqual(
        batch.map((name) => ({ name, mimeType: attachmentMimeTypeForName(name), base64: btoa("hello") })),
      );
      act(() => state().clear());
    }
  });
  it("keeps valid files when an unsupported or oversized selection fails and allows removal", async () => {
    const state = mount();
    native.documents.mockResolvedValue({
      canceled: false,
      assets: [
        { name: "ok.txt", uri: "file:///ok.txt" },
        { name: "bad.exe", uri: "file:///bad.exe" },
      ],
    });
    await act(async () => {
      await state().chooseFiles();
    });
    expect(state().items.map((item) => item.name)).toEqual(["ok.txt"]);
    expect(native.alert).toHaveBeenCalledWith("Could not add attachment", expect.stringContaining("Choose"));
    native.size = MOBILE_ATTACHMENT_BYTES + 1;
    native.documents.mockResolvedValue({ canceled: false, assets: [{ name: "large.pdf", uri: "file:///large.pdf" }] });
    await act(async () => {
      await state().chooseFiles();
    });
    expect(native.alert).toHaveBeenCalledWith("Could not add attachment", "Attachments must be 10 MB or smaller.");
    act(() => state().remove(state().items[0].id));
    expect(state().items).toEqual([]);
  });
  it("handles camera permission, native picker cancellation, and a captured photo", async () => {
    const state = mount();
    native.permission.mockResolvedValue({ granted: false });
    await act(async () => {
      await state().takePhoto();
    });
    expect(native.camera).not.toHaveBeenCalled();
    expect(native.alert).toHaveBeenCalledWith(
      "Could not add attachment",
      "Allow camera access in Settings to take a photo.",
    );
    native.photos.mockResolvedValue({ canceled: true });
    await act(async () => {
      await state().choosePhotos();
    });
    expect(state().items).toEqual([]);
    native.permission.mockResolvedValue({ granted: true });

    await act(async () => {
      await state().takePhoto();
    });
    expect(state().cameraOpen).toBe(true);
    await act(async () => {
      await state().addPhoto("file:///photo.jpg");
    });
    expect(state().cameraOpen).toBe(false);
    expect(state().items.map((item) => ({ name: item.name, mime: item.mimeType }))).toEqual([
      { name: "photo.jpg", mime: "image/jpeg" },
    ]);
  });
  it("rejects malformed pasted data and a selection beyond ten attachments", async () => {
    const state = mount();
    expect(() =>
      state().paste({ type: "image", data: "data:image/png;base64,%%%", size: { width: 1, height: 1 } }, () => {}),
    ).toThrow("damaged");
    native.documents.mockResolvedValue({
      canceled: false,
      assets: Array.from({ length: 11 }, (_, index) => ({ name: `${index}.txt`, uri: `file:///${index}.txt` })),
    });
    await act(async () => {
      await state().chooseFiles();
    });
    expect(state().items).toHaveLength(10);
    expect(native.alert).toHaveBeenCalledWith("Could not add attachment", "You can attach up to 10 files.");
  });
});
