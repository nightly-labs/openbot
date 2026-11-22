import { useEffect, useSyncExternalStore } from "react";

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
  svgUrl: string | null;
  pngUrl: string | null;
  width: number;
  height: number;
}

const DIAGRAM_LIMIT = 40;
const DRAWING: MermaidDiagram = { status: "drawing" };
const diagrams = new Map<string, MermaidDiagram>();
const jobKeys = new Map<string, string>();
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

function trim(): void {
  for (const [key, diagram] of diagrams) {
    if (diagrams.size <= DIAGRAM_LIMIT) return;
    if (diagram.status === "drawing" || consumers.has(key)) continue;
    diagrams.delete(key);
  }
}

function requestMermaidDiagram(source: string, dark: boolean): void {
  const key = diagramKey(source, dark);
  if (diagrams.has(key)) return;
  diagrams.set(key, DRAWING);
  jobCount += 1;
  const id = String(jobCount);
  jobKeys.set(id, key);
  jobs = [...jobs, { id, source, dark }];
  trim();
  emit();
}

function retainMermaidDiagram(source: string, dark: boolean): () => void {
  const key = diagramKey(source, dark);
  consumers.set(key, (consumers.get(key) ?? 0) + 1);
  requestMermaidDiagram(source, dark);
  return () => {
    const count = (consumers.get(key) ?? 1) - 1;
    if (count > 0) consumers.set(key, count);
    else consumers.delete(key);
    trim();
  };
}

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
  trim();
  emit();
}

export function useMermaidJobs(): readonly MermaidJob[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

export function useMermaidDiagram(source: string, dark: boolean, enabled = true): MermaidDiagram | undefined {
  const key = diagramKey(source, dark);
  const diagram = useSyncExternalStore(subscribe, () => diagrams.get(key));
  useEffect(() => (enabled ? retainMermaidDiagram(source, dark) : undefined), [enabled, source, dark]);
  return enabled ? (diagram ?? DRAWING) : diagram;
}
