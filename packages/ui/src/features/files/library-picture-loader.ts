import { onCleanup } from "solid-js";
import type { AttachmentMediaSource } from "../conversation/AttachmentCards";
import type { StoredFileRow } from "./files-view";

const PICTURES = "[data-file-id], [data-picture-id]";

export function createLibraryPictureLoader(options: {
  source: AttachmentMediaSource | undefined;
  file: (fileId: string) => StoredFileRow | undefined;
}) {
  const source = options.source;
  const refused = new Set<string>();
  let shown: IntersectionObserver | undefined;
  let added: MutationObserver | undefined;
  onCleanup(() => {
    added?.disconnect();
    shown?.disconnect();
  });

  function load(element: HTMLElement): void {
    const fileId = element.dataset.fileId ?? element.dataset.pictureId;
    const file = fileId === undefined ? undefined : options.file(fileId);
    if (
      !source ||
      !file ||
      file.previewUrl ||
      file.previewKind !== "image" ||
      file.status !== "available" ||
      file.size > source.thumbnailLimit ||
      refused.has(file.id)
    )
      return;
    const refuse = () => refused.add(file.id);
    void source.load(file).then((loaded) => {
      if (!loaded) refuse();
    }, refuse);
  }

  function attach(container: HTMLElement): void {
    if (!source || typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;
    const visible = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.target.isConnected) visible.unobserve(entry.target);
        else if (entry.isIntersecting && entry.target instanceof HTMLElement) load(entry.target);
      }
    });
    const watch = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.matches(PICTURES)) visible.observe(node);
      for (const element of node.querySelectorAll(PICTURES)) visible.observe(element);
    };
    const changes = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) watch(node);
    });
    watch(container);
    changes.observe(container, { childList: true, subtree: true });
    shown = visible;
    added = changes;
  }

  return { attach };
}
