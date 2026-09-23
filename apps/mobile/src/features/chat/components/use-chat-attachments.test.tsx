import { ATTACHMENT_FILE_EXTENSIONS, attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { useChatAttachments } from "./use-chat-attachments";

const native = vi.hoisted(() => ({
  documents: vi.fn(),
  camera: vi.fn(),
  photos: vi.fn(),
  permission: vi.fn(),
  alert: vi.fn(),
  size: 5,
  base64Impl: async (_uri: string) => btoa("hello"),
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
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    async base64() {
      return native.base64Impl(this.uri);
    }
  },
}));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  native.size = 5;
  native.base64Impl = async (_uri: string) => btoa("hello");
  vi.clearAllMocks();
});
function mount(persist?: Parameters<typeof useChatAttachments>[1], support?: Parameters<typeof useChatAttachments>[2]) {
  const container = document.createElement("div");
  const root = createRoot(container);
  let attachments: ReturnType<typeof useChatAttachments> | null = null;
  function Harness() {
    attachments = useChatAttachments([], persist, support);
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
    expect(native.alert).toHaveBeenCalledWith("Could not add attachment", expect.stringMatching(/^bad\.exe: choose/u));
    native.size = MOBILE_ATTACHMENT_BYTES + 1;
    native.documents.mockResolvedValue({ canceled: false, assets: [{ name: "large.pdf", uri: "file:///large.pdf" }] });
    await act(async () => {
      await state().chooseFiles();
    });
    expect(native.alert).toHaveBeenCalledWith("Could not add attachment", "large.pdf is larger than 10 MB.");
    const [large] = state().items;
    assert(large);
    act(() => state().remove(large.id));
    expect(state().items).toEqual([]);
  });
  it("handles camera permission, native picker cancellation, and a captured photo", async () => {
    const state = mount();
    const plus = { left: 28, bottom: 18, size: 32 };
    act(() => state().openMenu(plus));
    expect(state().menuOpen).toBe(true);
    expect(state().menuAnchor).toEqual(plus);
    native.permission.mockResolvedValue({ granted: false });
    // A refusal keeps the card open on the options, so it reports the refusal
    // instead of throwing at a caller that has nothing to unwind.
    await act(async () => {
      expect(await state().requestCamera()).toBe(false);
    });
    expect(native.camera).not.toHaveBeenCalled();
    expect(native.alert).toHaveBeenCalledWith(
      "Could not add attachment",
      "Allow camera access in Settings to take a photo.",
    );
    expect(state().menuOpen).toBe(true);
    native.photos.mockResolvedValue({ canceled: true });
    await act(async () => {
      await state().choosePhotos();
    });
    expect(state().items).toEqual([]);
    native.permission.mockResolvedValue({ granted: true });

    await act(async () => {
      expect(await state().requestCamera()).toBe(true);
    });
    await act(async () => {
      await state().addPhoto("file:///photo.jpg");
    });
    // Holding the photo no longer closes the card: it dismisses itself once the
    // photo is held, so it can collapse back into the control it opened from.
    expect(state().menuOpen).toBe(true);
    act(() => state().closeMenu());
    expect(state().menuOpen).toBe(false);
    expect(state().menuAnchor).toBeNull();
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

it("accepts a paste only after persistence succeeds and leaves existing items on failure", async () => {
  let complete = () => {};
  const persist = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const state = mount(persist);
  let saving: Promise<void> | undefined;
  act(() => {
    saving = state().paste({ type: "text", text: "a".repeat(4001) }, () => {});
  });
  expect(state().preparing).toBe(true);
  expect(state().items).toEqual([]);
  await act(async () => {
    complete();
    await saving;
  });
  expect(state().items).toHaveLength(1);
  persist.mockRejectedValueOnce(new Error("Disk full"));
  await act(async () => {
    await expect(state().paste({ type: "text", text: "b".repeat(4001) }, () => {})).rejects.toThrow("Disk full");
  });
  expect(state().items).toHaveLength(1);
  expect(state().preparing).toBe(false);
});

it("keeps preparing true while later files of one selection are still reading", async () => {
  // The first persist finishes before the second read. Clearing the flag there
  // would report idle while the selection is still running.
  const persist = vi.fn(async () => {});
  const state = mount(persist);
  native.documents.mockResolvedValue({
    canceled: false,
    assets: [
      { name: "a.txt", uri: "file:///a.txt" },
      { name: "b.txt", uri: "file:///b.txt" },
    ],
  });
  let releaseSecond: () => void = () => {};
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  native.base64Impl = async (uri: string) => {
    if (uri.endsWith("b.txt")) await secondGate;
    return btoa("hello");
  };
  let selecting: Promise<void> | undefined;
  act(() => {
    selecting = state().chooseFiles();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(state().items.map((item) => item.name)).toEqual(["a.txt"]);
  expect(state().preparing).toBe(true);
  await act(async () => {
    releaseSecond();
    await selecting;
  });
  expect(state().items.map((item) => item.name)).toEqual(["a.txt", "b.txt"]);
  expect(state().preparing).toBe(false);
  expect(persist).toHaveBeenCalledTimes(2);
});

it("rejects formats the selected host does not accept, with the file name, and keeps the others", async () => {
  const state = mount(undefined, () => ({ eml: false, media: false }));
  native.documents.mockResolvedValue({
    canceled: false,
    assets: [
      { name: "notes.txt", uri: "file:///notes.txt" },
      { name: "clip.mov", uri: "file:///clip.mov" },
      { name: "after.txt", uri: "file:///after.txt" },
    ],
  });
  await act(async () => {
    await state().chooseFiles();
  });
  expect(state().items.map((item) => item.name)).toEqual(["notes.txt"]);
  expect(native.alert).toHaveBeenCalledWith(
    "Could not add attachment",
    "clip.mov: the host computer does not accept MOV files. Update OpenBot there to attach them.",
  );
});

it("replaces one file in place, keeps the order, and changes nothing when the picker is cancelled", async () => {
  const state = mount();
  native.documents.mockResolvedValue({
    canceled: false,
    assets: ["a.txt", "b.txt", "c.txt"].map((name) => ({ name, uri: `file:///${name}` })),
  });
  await act(async () => {
    await state().chooseFiles();
  });
  const [first, second, third] = state().items;
  assert(second);
  native.documents.mockResolvedValue({ canceled: true });
  await act(async () => {
    await state().replace(second.id);
  });
  expect(state().items).toEqual([first, second, third]);
  native.documents.mockResolvedValue({ canceled: false, assets: [{ name: "new.md", uri: "file:///new.md" }] });
  await act(async () => {
    await state().replace(second.id);
  });
  expect(state().items.map((item) => item.name)).toEqual(["a.txt", "new.md", "c.txt"]);
  expect(native.documents).toHaveBeenLastCalledWith({ multiple: false, copyToCacheDirectory: true });
  const [, replaced] = state().items;
  assert(replaced);
  expect(replaced.id).not.toBe(second.id);
});

it("replaces an image from the photo library and reads its shape from the file", async () => {
  const state = mount();
  // A 1600 x 900 PNG header.
  const png = String.fromCharCode(
    0x89,
    ..."PNG\r\n\x1a\n".split("").map((character) => character.charCodeAt(0)),
    0,
    0,
    0,
    13,
    ..."IHDR".split("").map((character) => character.charCodeAt(0)),
    0,
    0,
    0x06,
    0x40,
    0,
    0,
    0x03,
    0x84,
    8,
    6,
    0,
    0,
  );
  native.base64Impl = async () => btoa(png);
  native.photos.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///one.png", fileName: "one.png" }] });
  await act(async () => {
    await state().choosePhotos();
  });
  const [photo] = state().items;
  assert(photo);
  expect(photo.dimensions).toEqual({ width: 1600, height: 900 });
  native.photos.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///two.png", fileName: "two.png" }] });
  await act(async () => {
    await state().replace(photo.id);
  });
  expect(state().items.map((item) => item.name)).toEqual(["two.png"]);
});
