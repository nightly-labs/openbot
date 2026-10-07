import { CHAT_MERMAID_FONT_FAMILY, mermaidImageUrl } from "@openbot/contracts/chat-preview";

type Mermaid = typeof import("mermaid")["default"];

let mermaid: Promise<Mermaid> | undefined;

/** Mermaid is large, so the app loads it when the first diagram shows, not at start. */
function loadMermaid(): Promise<Mermaid> {
  mermaid ??= import("mermaid").then(
    ({ default: api }) => {
      // `strict` escapes the HTML in labels and turns off click handlers; a diagram cannot change it.
      api.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        fontFamily: CHAT_MERMAID_FONT_FAMILY,
        suppressErrorRendering: true,
      });
      return api;
    },
    (error: unknown) => {
      mermaid = undefined;
      throw error;
    },
  );
  return mermaid;
}

/** A drawn diagram, or why Mermaid could not draw it. */
export type MermaidDiagram =
  | { status: "ready"; url: string }
  /** Mermaid did not load. A retry can work. */
  | { status: "unavailable" }
  /** Mermaid cannot parse the source. The message is Mermaid's own, such as the line of the error. */
  | { status: "invalid"; message: string };

// Settled messages render again as the list scrolls, so each diagram is drawn once. Cap the size
// so a long session cannot grow this without bound.
const DIAGRAM_CACHE_LIMIT = 100;
const diagramCache = new Map<string, Promise<MermaidDiagram>>();
let diagramCount = 0;

/**
 * The diagram of a Mermaid source as an image URL. The SVG is shown as an image, not put in the
 * page, so nothing in it can run in the app.
 */
export function mermaidDiagram(source: string): Promise<MermaidDiagram> {
  const cached = diagramCache.get(source);
  if (cached) return cached;
  diagramCount += 1;
  const id = `openbot-mermaid-${diagramCount}`;
  const diagram = drawDiagram(id, source);
  if (diagramCache.size >= DIAGRAM_CACHE_LIMIT) {
    const oldest = diagramCache.keys().next();
    if (!oldest.done) diagramCache.delete(oldest.value);
  }
  diagramCache.set(source, diagram);
  return diagram;
}

async function drawDiagram(id: string, source: string): Promise<MermaidDiagram> {
  let api: Mermaid;
  try {
    api = await loadMermaid();
  } catch {
    // A load failure is not kept, so the next attempt loads Mermaid again.
    diagramCache.delete(source);
    return { status: "unavailable" };
  }
  try {
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
