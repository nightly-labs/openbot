import { CHAT_MERMAID_FONT_FAMILY, mermaidImageUrl } from "@openbot/contracts/chat-preview";
import type { DocumentColorScheme } from "../../document-color-scheme";

type Mermaid = typeof import("mermaid")["default"];

let mermaid: Promise<Mermaid> | undefined;

/** Mermaid is large, so the app loads it when the first diagram shows, not at start. */
function loadMermaid(): Promise<Mermaid> {
  mermaid ??= import("mermaid").then(
    ({ default: api }) => {
      initializeMermaid(api, "dark");
      return api;
    },
    (error: unknown) => {
      mermaid = undefined;
      throw error;
    },
  );
  return mermaid;
}

/** `strict` escapes the HTML in labels and turns off click handlers; a diagram cannot change it. */
function initializeMermaid(api: Mermaid, scheme: DocumentColorScheme): void {
  api.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // `neutral` is gray, as the light palette is; `default` draws lavender boxes.
    theme: scheme === "light" ? "neutral" : "dark",
    // The app has no drop shadows; on the light palette Mermaid's shows under each box.
    themeVariables: { dropShadow: "none" },
    fontFamily: CHAT_MERMAID_FONT_FAMILY,
    // HTML labels write a line break as an unclosed `<br>`, and an image of that SVG does not load.
    htmlLabels: false,
    suppressErrorRendering: true,
  });
}

/** A drawn diagram, or why Mermaid could not draw it. */
export type MermaidDiagram =
  | { status: "ready"; url: string }
  /** Mermaid did not load. A retry can work. */
  | { status: "unavailable" }
  /** Mermaid cannot parse the source. The message is Mermaid's own, such as the line of the error. */
  | { status: "invalid"; message: string };

// Settled messages render again as the list scrolls, so each diagram is drawn once for each palette.
// Cap the size so a long session cannot grow this without bound.
const DIAGRAM_CACHE_LIMIT = 100;
const diagramCache = new Map<string, Promise<MermaidDiagram>>();
let diagramCount = 0;
// The theme is Mermaid's global setting, so a drawing waits for the one before it.
let drawing: Promise<unknown> = Promise.resolve();

/**
 * The diagram of a Mermaid source as an image URL. The SVG is shown as an image, not put in the
 * page, so nothing in it can run in the app.
 */
export function mermaidDiagram(source: string, scheme: DocumentColorScheme): Promise<MermaidDiagram> {
  const key = `${scheme}\n${source}`;
  const cached = diagramCache.get(key);
  if (cached) return cached;
  diagramCount += 1;
  const id = `openbot-mermaid-${diagramCount}`;
  const diagram = drawing.then(() => drawDiagram(id, key, source, scheme));
  drawing = diagram;
  if (diagramCache.size >= DIAGRAM_CACHE_LIMIT) {
    const oldest = diagramCache.keys().next();
    if (!oldest.done) diagramCache.delete(oldest.value);
  }
  diagramCache.set(key, diagram);
  return diagram;
}

async function drawDiagram(
  id: string,
  key: string,
  source: string,
  scheme: DocumentColorScheme,
): Promise<MermaidDiagram> {
  let api: Mermaid;
  try {
    api = await loadMermaid();
  } catch {
    // A load failure is not kept, so the next attempt loads Mermaid again.
    diagramCache.delete(key);
    return { status: "unavailable" };
  }
  try {
    initializeMermaid(api, scheme);
    const { svg } = await api.render(id, source);
    return { status: "ready", url: mermaidImageUrl(svg) };
  } catch (error) {
    return { status: "invalid", message: mermaidErrorMessage(error) };
  }
}

/** Mermaid's parse message, without the blank lines around it, and at most a few lines. */
function mermaidErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim().split("\n").slice(0, 6).join("\n");
}
