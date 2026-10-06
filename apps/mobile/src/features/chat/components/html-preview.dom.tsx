"use dom";

import { chatHtmlPreviewDocument } from "@openbot/contracts/chat-preview";
import { useEffect, useRef, useState } from "react";

interface HtmlPreviewProps {
  source: string;
  title: string;
  /** `card` draws the page as a small, still picture at a phone width; `screen` is the live page. */
  mode: "card" | "screen";
  /** The space that the floating header and the home indicator cover on the preview screen. */
  topInset?: number;
  bottomInset?: number;
  background: string;
  onOpenLink?: (url: string) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

/** The width that a card lays the page out at before it scales it down, so it looks like a phone screen. */
const CARD_PAGE_WIDTH = 390;

/**
 * A ```html page from a reply. The page is in a sandboxed frame with no scripts and no requests,
 * as on desktop: nothing that an agent writes runs in this web view, which can call back into the
 * app. `allow-same-origin` is safe without `allow-scripts`; it lets this view open the page's links.
 */
export default function HtmlPreview({
  source,
  title,
  mode,
  topInset = 0,
  bottomInset = 0,
  background,
  onOpenLink,
}: HtmlPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // The page runs under the glass header, as the chat does, so it starts below the header and
  // scrolls behind it. The space is padding of the page itself: the frame fills the screen.
  useEffect(() => placePage(frame.current, topInset, bottomInset), [topInset, bottomInset]);

  const attachLinks = () => {
    placePage(frame.current, topInset, bottomInset);
    const page = frame.current?.contentDocument;
    if (!page || !onOpenLink) return;
    page.addEventListener("click", (event) => {
      const path = event.composedPath();
      const link = [...page.querySelectorAll("a")].find((anchor) => path.includes(anchor));
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        page.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
        return;
      }
      void onOpenLink(href);
    });
  };

  if (mode === "card") {
    const scale = width / CARD_PAGE_WIDTH;
    return (
      <div style={{ position: "fixed", inset: 0, overflow: "hidden", background, pointerEvents: "none" }}>
        <iframe
          title={title}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={chatHtmlPreviewDocument(source)}
          tabIndex={-1}
          style={{
            width: CARD_PAGE_WIDTH,
            height: `${100 / scale}%`,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", background }}>
      <iframe
        ref={frame}
        title={title}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={chatHtmlPreviewDocument(source)}
        onLoad={attachLinks}
        style={{ flex: 1, width: "100%", height: "100%", border: 0 }}
      />
    </div>
  );
}

/**
 * Adds the header and home indicator space to the page body's own padding. The body background
 * then fills the space under the header, and the page keeps the padding that it set itself.
 */
function placePage(frame: HTMLIFrameElement | null, top: number, bottom: number): void {
  const body = frame?.contentDocument?.body;
  if (!body) return;
  const own = getComputedStyle(body);
  body.dataset.openbotPaddingTop ??= own.paddingTop;
  body.dataset.openbotPaddingBottom ??= own.paddingBottom;
  body.style.paddingTop = `calc(${body.dataset.openbotPaddingTop} + ${top}px)`;
  body.style.paddingBottom = `calc(${body.dataset.openbotPaddingBottom} + ${bottom}px)`;
}
