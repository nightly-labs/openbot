"use dom";

import { CHAT_MERMAID_FONT_FAMILY, mermaidImageUrl, sizedMermaidSvg } from "@openbot/contracts/chat-preview";
import mermaid from "mermaid";
import { useEffect, useRef } from "react";
import type { MermaidJob, MermaidResult } from "../model/mermaid-diagrams";

interface MermaidRendererProps {
  jobs: readonly MermaidJob[];
  onResult: (result: MermaidResult) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

/** The width of the chat card image, in pixels: about three times the card on a phone. */
const RASTER_WIDTH = 1080;
const RASTER_MAX_SCALE = 3;
/** Large diagrams are drawn smaller, so one image never takes much memory. */
const RASTER_MAX_PIXELS = 4_000_000;

// In Expo Go on Android the first render can have no props: react-native-webview cannot pass the
// initial props of text with escapes, and the props come again when the DOM side is ready.
const NO_JOBS: readonly MermaidJob[] = [];

/**
 * The one web view that runs Mermaid. It stays loaded, so only the first diagram waits for
 * Mermaid to start, and it draws each diagram once, one after another. `strict` escapes the HTML
 * in labels and turns off click handlers, and a diagram cannot change it. Labels are SVG text, not
 * HTML, so the web view can also draw the diagram to a canvas for the chat card.
 */
export default function MermaidRenderer({ jobs = NO_JOBS, onResult }: MermaidRendererProps) {
  const started = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const report = useRef(onResult);
  report.current = onResult;

  useEffect(() => {
    for (const job of jobs) {
      if (started.current.has(job.id)) continue;
      started.current.add(job.id);
      queue.current = queue.current
        .then(() => draw(job).then((result) => report.current(result)))
        .catch(() => undefined);
    }
    const current = new Set(jobs.map((job) => job.id));
    for (const id of started.current) if (!current.has(id)) started.current.delete(id);
  }, [jobs]);

  return null;
}

async function draw(job: MermaidJob): Promise<MermaidResult> {
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: job.dark ? "dark" : "default",
      fontFamily: CHAT_MERMAID_FONT_FAMILY,
      htmlLabels: false,
      suppressErrorRendering: true,
    });
    const { svg } = await mermaid.render(`openbot-mermaid-${job.id}`, job.source);
    const sized = sizedMermaidSvg(svg);
    const width = Number(/<svg\b[^>]*\bwidth="([\d.]+)"/u.exec(sized)?.[1] ?? 0);
    const height = Number(/<svg\b[^>]*\bheight="([\d.]+)"/u.exec(sized)?.[1] ?? 0);
    const svgUrl = mermaidImageUrl(svg);
    return { id: job.id, svgUrl, pngUrl: await raster(svgUrl, width, height), width, height };
  } catch {
    return { id: job.id, svgUrl: null, pngUrl: null, width: 0, height: 0 };
  }
}

async function raster(url: string, width: number, height: number): Promise<string | null> {
  if (!width || !height) return null;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    let scale = Math.min(RASTER_MAX_SCALE, RASTER_WIDTH / width);
    if (width * height * scale * scale > RASTER_MAX_PIXELS) scale = Math.sqrt(RASTER_MAX_PIXELS / (width * height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    // A browser can refuse to read back an SVG drawing; the card then shows the code instead.
    return null;
  }
}
