import { useEffect, useSyncExternalStore } from "react";

/** A diagram that the renderer drew: an SVG for the zoomable canvas and a PNG for the chat card. */
export type MermaidDiagram =
  | { status: "drawing" }
  | { status: "ready"; svgUrl: string; pngUrl: string | null; width: number; height: number }
  | { status: "failed" };

export interface MermaidJob {
  id: string;
  source: string;
  dark: boolean;
}

export interface MermaidResult {
  id: string;
  /** The SVG as an image URL, or null when Mermaid could not parse the source. */
  svgUrl: string | null;
  /** A raster copy for a native image, or null when the web view could not make one. */
  pngUrl: string | null;
  width: number;
  height: number;
}

// One web view draws every diagram once, and each card and screen reads the result from here, so
// a diagram that scrolls back into view or opens on its own screen shows at once. The cap keeps a
// long session from holding every image.
const DIAGRAM_LIMIT = 40;
const DRAWING: MermaidDiagram = { status: "drawing" };
const diagrams = new Map<string, MermaidDiagram>();
const jobKeys = new Map<string, string>();
/** How many mounted cards and screens show each diagram. The cache never lets one of these go. */
const consumers = new Map<string, number>();
const listeners = new Set<() => void>();
let jobs: readonly MermaidJob[] = [];
let jobCount = 0;

function diagramKey(source: string, dark: boolean): string {
  return `${dark ? "dark" : "light"}:${source}`;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function forgetOldest(): void {
  if (diagrams.size < DIAGRAM_LIMIT) return;
  // A diagram that is still drawing has a job that will report to it, and a diagram on screen is
  // in use, so both stay. When every diagram is in use, the cache grows past its limit.
  for (const [key, diagram] of diagrams) {
    if (diagram.status === "drawing" || consumers.has(key)) continue;
    diagrams.delete(key);
    return;
  }
}

function requestMermaidDiagram(source: string, dark: boolean): void {
  const key = diagramKey(source, dark);
  if (diagrams.has(key)) return;
  forgetOldest();
  diagrams.set(key, DRAWING);
  jobCount += 1;
  const id = String(jobCount);
  jobKeys.set(id, key);
  jobs = [...jobs, { id, source, dark }];
  emit();
}

/** Marks a diagram as on screen and draws it if needed. The returned function releases it. */
function retainMermaidDiagram(source: string, dark: boolean): () => void {
  const key = diagramKey(source, dark);
  consumers.set(key, (consumers.get(key) ?? 0) + 1);
  requestMermaidDiagram(source, dark);
  return () => {
    const count = (consumers.get(key) ?? 1) - 1;
    if (count > 0) consumers.set(key, count);
    else consumers.delete(key);
  };
}

/** Stores what the renderer drew and removes its job. */
export function receiveMermaidResult(result: MermaidResult): void {
  const key = jobKeys.get(result.id);
  jobKeys.delete(result.id);
  jobs = jobs.filter((job) => job.id !== result.id);
  if (key)
    diagrams.set(
      key,
      result.svgUrl
        ? {
            status: "ready",
            svgUrl: result.svgUrl,
            pngUrl: result.pngUrl,
            width: result.width,
            height: result.height,
          }
        : { status: "failed" },
    );
  emit();
}

/** The diagrams that wait for the renderer. */
export function useMermaidJobs(): readonly MermaidJob[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

/** The diagram of a source, drawn on first use. Pass `enabled: false` while the source still streams. */
export function useMermaidDiagram(source: string, dark: boolean, enabled = true): MermaidDiagram | undefined {
  const key = diagramKey(source, dark);
  const diagram = useSyncExternalStore(subscribe, () => diagrams.get(key));
  useEffect(() => (enabled ? retainMermaidDiagram(source, dark) : undefined), [enabled, source, dark]);
  return enabled ? (diagram ?? DRAWING) : undefined;
}
