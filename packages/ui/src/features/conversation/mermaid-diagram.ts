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

// Settled messages render again as the list scrolls, so each diagram is drawn once. Cap the size
// so a long session cannot grow this without bound.
const DIAGRAM_CACHE_LIMIT = 100;
const diagramCache = new Map<string, Promise<string | null>>();
let diagramCount = 0;

/**
 * The diagram of a Mermaid source as an image URL, or null when Mermaid cannot parse it. The SVG
 * is shown as an image, not put in the page, so nothing in it can run in the app.
 */
export function mermaidDiagramUrl(source: string): Promise<string | null> {
  const cached = diagramCache.get(source);
  if (cached) return cached;
  diagramCount += 1;
  const id = `openbot-mermaid-${diagramCount}`;
  const diagram = loadMermaid()
    .then((api) => api.render(id, source))
    .then(({ svg }) => mermaidImageUrl(svg))
    .catch(() => null);
  if (diagramCache.size >= DIAGRAM_CACHE_LIMIT) {
    const oldest = diagramCache.keys().next();
    if (!oldest.done) diagramCache.delete(oldest.value);
  }
  diagramCache.set(source, diagram);
  return diagram;
}
