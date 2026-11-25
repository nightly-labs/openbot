export interface AcpAgentPreset {
  id: string;
  name: string;
  command: string;
  args: readonly string[];
}

export const ACP_AGENT_PRESETS: readonly AcpAgentPreset[] = [
  { id: "goose", name: "Goose", command: "goose", args: ["acp"] },
  { id: "qwen", name: "Qwen Code", command: "qwen", args: ["--acp"] },
  { id: "omp", name: "Oh My Pi", command: "omp", args: ["acp"] },
];
