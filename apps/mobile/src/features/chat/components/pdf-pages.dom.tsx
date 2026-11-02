"use dom";

import { getDocument, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
// The worker module sets `globalThis.pdfjsWorker`, so pdf.js reads the file on this thread. Metro
// cannot bundle a separate worker file into a DOM component.
import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { useEffect, useRef, useState } from "react";
import { base64Bytes } from "../model/base64-bytes";

interface PdfPagesProps {
  /** The PDF file as Base64. */
  base64: string;
  title: string;
  /** The space that the floating header and the home indicator cover. */
  insets: { top: number; bottom: number };
  background: string;
  muted: string;
  failedText: string;
  dom?: import("expo/dom").DOMProps;
}

const PAGE_GAP = 12;
const SIDE_MARGIN = 12;
/** Sharper than this costs memory that a phone does not have for a long document. */
const MAX_PIXEL_RATIO = 2;
/** Pages this far outside the screen are drawn before they scroll in, and cleared after they leave. */
const DRAW_MARGIN = "100% 0px";

/**
 * The pages of a PDF, for Android: its web view cannot show a PDF itself. iOS shows the file in
 * a native web view instead. Each page has its size at once, and a page is drawn only while it is
 * near the screen, so a long document does not hold every page as a picture.
 */
// Missing in Expo Go on Android until the props come again; see expo-go-dom.ts.
const NO_INSETS = { top: 0, bottom: 0 };
export default function PdfPages({
  base64 = "",
  title = "",
  insets = NO_INSETS,
  background,
  muted,
  failedText = "",
}: PdfPagesProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = pages.current;
    const view = scroller.current;
    if (!base64 || !root || !view) return;
    setFailed(false);
    const task = getDocument({ data: base64Bytes(base64), useSystemFonts: true });
    let observer: IntersectionObserver | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const pdf = await task.promise;
        if (cancelled) return;
        observer = await layOutPages(pdf, view, root, () => cancelled);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      root.replaceChildren();
      void task.destroy();
    };
  }, [base64]);

  return (
    <div
      ref={scroller}
      role="document"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        overflowY: "auto",
        background,
        paddingTop: insets.top + PAGE_GAP,
        paddingBottom: insets.bottom + PAGE_GAP,
        boxSizing: "border-box",
      }}
    >
      {failed ? (
        <p style={{ color: muted, textAlign: "center", font: "15px system-ui", margin: "48px 24px" }}>{failedText}</p>
      ) : null}
      <div ref={pages} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: PAGE_GAP }} />
    </div>
  );
}

/** One frame for each page, sized at once, and an observer that draws the pages near the screen. */
async function layOutPages(
  pdf: PDFDocumentProxy,
  view: HTMLDivElement,
  root: HTMLDivElement,
  cancelled: () => boolean,
) {
  const width = root.clientWidth - SIDE_MARGIN * 2;
  const frames: HTMLDivElement[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    if (cancelled()) return null;
    const size = page.getViewport({ scale: 1 });
    const frame = document.createElement("div");
    frame.dataset.page = String(number);
    frame.style.cssText = `width:${width}px;height:${(width * size.height) / size.width}px;background:#fff;flex:none;`;
    root.append(frame);
    frames.push(frame);
  }
  const drawn = new Map<HTMLDivElement, { cancel: () => void }>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const frame = entry.target;
        if (!(frame instanceof HTMLDivElement)) continue;
        if (entry.isIntersecting && !drawn.has(frame)) drawn.set(frame, drawPage(pdf, frame, width));
        else if (!entry.isIntersecting && drawn.has(frame)) {
          drawn.get(frame)?.cancel();
          drawn.delete(frame);
          frame.replaceChildren();
        }
      }
    },
    { root: view, rootMargin: DRAW_MARGIN },
  );
  for (const frame of frames) observer.observe(frame);
  return observer;
}

function drawPage(pdf: PDFDocumentProxy, frame: HTMLDivElement, width: number) {
  let task: RenderTask | null = null;
  let stopped = false;
  void pdf.getPage(Number(frame.dataset.page)).then((page) => {
    if (stopped) return;
    const size = page.getViewport({ scale: 1 });
    const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    const viewport = page.getViewport({ scale: (width / size.width) * pixelRatio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.cssText = "width:100%;height:100%;display:block;";
    task = page.render({ canvas, viewport });
    task.promise.then(
      () => {
        if (!stopped) frame.replaceChildren(canvas);
      },
      // A page that scrolls away stops drawing, and a page that cannot be drawn stays white.
      () => undefined,
    );
  });
  return {
    cancel: () => {
      stopped = true;
      task?.cancel();
    },
  };
}
