/**
 * Variables that the Orca app sets in each of its terminal panes (Orca `AGENT_PANE_HOOK_ENV_KEYS`
 * and its session caller keys). When OpenBot starts from such a pane, the app gets them, and every
 * agent inherits them from this process. Orca's global provider hooks then send each OpenBot turn to
 * that pane, and the replies also show in an Orca AI tab (#10946). Other `ORCA_` variables stay.
 */
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

/** Removes the variables of an Orca pane that started this process. Windows compares names without case. */
export function removeOrcaPaneEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (ORCA_PANE_VARIABLES.has(name.toUpperCase())) delete environment[name];
  }
}
