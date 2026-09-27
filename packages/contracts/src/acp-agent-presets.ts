// Known agents that speak the Agent Client Protocol on stdio. The UI offers them as a start for the
// form, and the scan looks for these command names only: it never starts a file to learn what it is.
//
// Unverified: each flag comes from the agent's own documentation as of September 2026, not from a
// run in OpenBot. "Check agent" is the test, and a changed flag is one edit in the form.

export interface AcpAgentPreset {
  /** The custom agent id to suggest. */
  id: string;
  /** The product name, which is the same in each language. */
  name: string;
  command: string;
  args: readonly string[];
}

export const ACP_AGENT_PRESETS: readonly AcpAgentPreset[] = [
  { id: "goose", name: "Goose", command: "goose", args: ["acp"] },
  { id: "qwen", name: "Qwen Code", command: "qwen", args: ["--acp"] },
  { id: "cursor", name: "Cursor", command: "cursor-agent", args: ["acp"] },
  { id: "copilot", name: "GitHub Copilot", command: "copilot", args: ["--acp"] },
];
