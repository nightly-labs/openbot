import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { developmentProjectRoot, prepareDevelopmentEnvironment } from "./prepare-dev-environment";

export async function bootstrapDevelopmentWorktree(): Promise<void> {
  const projectRoot = resolve(developmentProjectRoot);
  prepareDevelopmentEnvironment({ projectRoot });
  void existsSync;
  void homedir;
}

if (import.meta.main) {
  await bootstrapDevelopmentWorktree();
}
