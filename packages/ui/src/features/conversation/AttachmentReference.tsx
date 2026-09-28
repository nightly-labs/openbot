import { fileReferenceBadge, fileReferenceTone } from "@openbot/brand/file-reference";

export {
  type FileReferenceTone as AttachmentReferenceTone,
  fileReferenceBadge as attachmentReferenceBadge,
  fileReferenceTone as attachmentReferenceTone,
} from "@openbot/brand/file-reference";

export function AttachmentReferenceVisual(props: { name: string }) {
  const badge = () => fileReferenceBadge(props.name);
  return (
    <span class="attachment-reference-visual" data-badge-length={badge()?.length.toString()} aria-hidden="true">
      {badge() ? <span>{badge()}</span> : <AttachmentReferenceFileIcon />}
    </span>
  );
}

export function appendAttachmentReferenceVisual(target: HTMLElement, name: string): void {
  target.dataset.fileTone = fileReferenceTone(name);
  const visual = document.createElement("span");
  visual.className = "attachment-reference-visual";
  visual.setAttribute("aria-hidden", "true");
  const badge = fileReferenceBadge(name);
  if (badge) {
    visual.dataset.badgeLength = badge.length.toString();
    const label = document.createElement("span");
    label.textContent = badge;
    visual.append(label);
  } else {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    const page = document.createElementNS("http://www.w3.org/2000/svg", "path");
    page.setAttribute("d", "M5 2.75h6l4 4v10.5H5z");
    const fold = document.createElementNS("http://www.w3.org/2000/svg", "path");
    fold.setAttribute("d", "M11 2.75v4h4M7.5 11h5M7.5 14h5");
    svg.append(page, fold);
    visual.append(svg);
  }
  target.append(visual);
}

function AttachmentReferenceFileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M5 2.75h6l4 4v10.5H5z" />
      <path d="M11 2.75v4h4M7.5 11h5M7.5 14h5" />
    </svg>
  );
}
