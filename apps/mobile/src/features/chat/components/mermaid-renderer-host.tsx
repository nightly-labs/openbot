import { useState } from "react";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { receiveMermaidResult, useMermaidJobs } from "../model/mermaid-diagrams";
import MermaidRenderer from "./mermaid-renderer.dom";

/**
 * Starts the Mermaid web view when the first diagram needs it and keeps it for the session, so
 * an account with no diagrams never loads Mermaid. The web view is hidden and takes no touches.
 */
export function MermaidRendererHost() {
  const jobs = useMermaidJobs();
  const [started, setStarted] = useState(false);
  if (!started && jobs.length > 0) setStarted(true);
  if (!started) return null;
  return (
    <MermaidRenderer
      jobs={jobs}
      onResult={async (result) => receiveMermaidResult(result)}
      dom={{
        ...expoGoDomOptions,
        containerStyle: { flex: 0, height: 1, left: 0, opacity: 0, position: "absolute", top: 0, width: 1 },
        pointerEvents: "none",
        scrollEnabled: false,
        style: { flex: 0, height: 1, width: 1 },
      }}
    />
  );
}
