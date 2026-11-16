import { onCleanup } from "solid-js";
import type { AttachmentMediaSource } from "../conversation/AttachmentCards";
import type { StoredFileRow } from "./files-view";

/**
 * Loads the pictures of the Library from the host when their tiles or rows show. The web client gets
 * no `previewUrl`, so a picture is a file card until it arrives. Only a shown picture loads, so a
 * large Library does not fill the media cache. A picture that does not load keeps its file card.
 */
export function createLibraryPictureLoader(options: {
  source: AttachmentMediaSource | undefined;
  /** The file of a tile or row, with the `previewUrl` of a picture that arrived. */
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
    const fileId = element.dataset.fileId;
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

  /** Watches each element with `data-file-id` in `container`, now and after each change of the page. */
  function attach(container: HTMLElement): void {
    if (!source || typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;
    const visible = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // A tile that went reports once more, as not shown.
        if (!entry.target.isConnected) visible.unobserve(entry.target);
        else if (entry.isIntersecting && entry.target instanceof HTMLElement) load(entry.target);
      }
    });
    const watch = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node.hasAttribute("data-file-id")) visible.observe(node);
      for (const element of node.querySelectorAll("[data-file-id]")) visible.observe(element);
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
