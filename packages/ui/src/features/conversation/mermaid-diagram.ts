import { CHAT_MERMAID_FONT_FAMILY, mermaidImageUrl } from "@openbot/contracts/chat-preview";
import type { DocumentColorScheme } from "../../document-color-scheme";

type Mermaid = typeof import("mermaid")["default"];

let mermaid: Promise<Mermaid> | undefined;

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

function initializeMermaid(api: Mermaid, scheme: DocumentColorScheme): void {
  api.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: scheme === "light" ? "neutral" : "dark",
    themeVariables: { dropShadow: "none" },
    fontFamily: CHAT_MERMAID_FONT_FAMILY,
    htmlLabels: false,
    suppressErrorRendering: true,
  });
}

export type MermaidDiagram =
  | { status: "ready"; url: string }
  | { status: "unavailable" }
  | { status: "invalid"; message: string };

const DIAGRAM_CACHE_LIMIT = 100;
const diagramCache = new Map<string, Promise<MermaidDiagram>>();
let diagramCount = 0;
let drawing: Promise<unknown> = Promise.resolve();

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

function mermaidErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim().split("\n").slice(0, 6).join("\n");
}
