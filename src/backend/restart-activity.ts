import type { AgentEvent } from "@openbot/contracts/ipc";

// One generation per application process. No content or identifiers are stored or exported.
// Event sources advance it even when their work completes between host-status polls.
let generation = 0;

export function recordRestartActivity(): void {
  generation += 1;
}

export function restartActivityGeneration() {
  return generation;
}

export function recordAgentRestartActivity(event: AgentEvent): void {
  switch (event.type) {
    case "turn-started":
    case "turn-completed":
    case "queue-changed":
    case "queue-invalidated":
    case "channels-changed":
    case "browser-control-changed":
      recordRestartActivity();
      break;
  }
}
