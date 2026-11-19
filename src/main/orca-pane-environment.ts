const ORCA_PANE_VARIABLES = new Set([
  "ORCA_PANE_KEY",
  "ORCA_TAB_ID",
  "ORCA_WORKTREE_ID",
  "ORCA_AGENT_LAUNCH_TOKEN",
  "ORCA_AGENT_PANE",
  "ORCA_AGENT_LAUNCH",
  "ORCA_AGENT_HOOK_PORT",
  "ORCA_AGENT_HOOK_TOKEN",
  "ORCA_AGENT_HOOK_ENV",
  "ORCA_AGENT_HOOK_VERSION",
  "ORCA_AGENT_HOOK_TRANSPORT",
  "ORCA_AGENT_HOOK_ENDPOINT",
  "ORCA_CLAUDE_AGENT_STATUS_SETTINGS",
  "ORCA_AGENT_SESSION_ID",
  "ORCA_STRUCTURED_SESSION",
]);

export function removeOrcaPaneEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (ORCA_PANE_VARIABLES.has(name.toUpperCase())) delete environment[name];
  }
}
