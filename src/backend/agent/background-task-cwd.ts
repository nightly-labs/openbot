import { resolve, sep } from "node:path";

/**
 * The folder a managed task runs in, or null when it would leave the agent's workspace.
 * A relative path is resolved against the workspace, and the workspace itself is always allowed.
 */
export function resolveBackgroundTaskCwd(root: string, cwd: string | undefined): string | null {
  const workspace = cwd === undefined ? root : resolve(root, cwd);
  if (workspace !== root && !workspace.startsWith(`${root}${sep}`)) return null;
  return workspace;
}
