import type { AgentEvent } from "@openbot/contracts/ipc";

interface AgentActivity {
  state: "idle" | "busy" | "waiting";
  since: string | null;
}

interface AgentActivityControllerOptions {
  waitsForPerson(agentId: string): boolean;
  runsWork(agentId: string): boolean;
}

/** Owns the time of each agent's activity transition for the lifetime of this host process. */
export class AgentActivityController {
  readonly #options: AgentActivityControllerOptions;
  readonly #activity = new Map<string, AgentActivity>();

  constructor(options: AgentActivityControllerOptions) {
    this.#options = options;
  }

  read(agentId: string): AgentActivity {
    const state = this.#state(agentId);
    const recorded = this.#activity.get(agentId);
    return recorded?.state === state ? recorded : { state, since: null };
  }

  observe(event: AgentEvent): void {
    switch (event.type) {
      case "prompt":
      case "agent-input-resolved":
      case "browser-takeover-resolved":
        this.refresh(event.agentId);
        break;
      case "approval":
        this.refresh(event.approval.agentId);
        break;
      case "browser-takeover-requested":
        this.refresh(event.request.agentId);
        break;
      case "runtime-snapshot":
        // Background subagents can finish after their parent turn.
        for (const agentId of this.#activity.keys()) this.refresh(agentId);
        break;
      case "agents-changed": {
        const agentIds = new Set(event.agents.map((agent) => agent.id));
        for (const agentId of this.#activity.keys()) if (!agentIds.has(agentId)) this.#activity.delete(agentId);
        break;
      }
    }
  }

  #state(agentId: string): AgentActivity["state"] {
    if (this.#options.waitsForPerson(agentId)) return "waiting";
    return this.#options.runsWork(agentId) ? "busy" : "idle";
  }

  refresh(agentId: string): void {
    const state = this.#state(agentId);
    const previous = this.#activity.get(agentId);
    if (previous?.state === state || (!previous && state === "idle")) return;
    this.#activity.set(agentId, { state, since: new Date().toISOString() });
  }
}
