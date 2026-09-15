/**
 * Environment flags the Electron runtime itself reads, which must never reach
 * a spawned Electron child.
 *
 * Agent shells often run inside an Electron harness that sets
 * `ELECTRON_RUN_AS_NODE=1` (this process is proof: it runs as Node inside
 * Electron). The dev scripts forward the parent environment to electron-vite
 * and the Electron binary, and a leaked `ELECTRON_RUN_AS_NODE=1` makes the
 * child run as plain Node: it loads the built main entry with the Node module
 * loader and dies with
 * `SyntaxError: ... does not provide an export named 'BrowserWindow'`.
 * `ELECTRON_EXTRA_LAUNCH_ARGS` would likewise inject flags into every
 * spawned Electron, so both are stripped at every Electron spawn boundary.
 */

export const ELECTRON_RUNTIME_ENV_KEYS = ["ELECTRON_RUN_AS_NODE", "ELECTRON_EXTRA_LAUNCH_ARGS"] as const;

export function withoutElectronRuntimeFlags(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child = { ...environment };
  for (const key of ELECTRON_RUNTIME_ENV_KEYS) delete child[key];
  return child;
}
