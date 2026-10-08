import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  developmentChildEnvironment,
  developmentSettingsForService,
  loadDevelopmentEnvironment,
  loadTestDeploymentEnvironment,
  requireDevelopmentValues,
} from "./development-environment";
import { resolvePackageBin } from "./package-bin";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const [mode, ...extra] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (!mode || !["api", "remote", "stripe", "stripe-e2e", "deploy-test"].includes(mode)) {
    throw new Error("Choose api, remote, stripe, stripe-e2e, or deploy-test.");
  }
  const environment =
    mode === "deploy-test"
      ? await loadTestDeploymentEnvironment(projectRoot)
      : await loadDevelopmentEnvironment(projectRoot);
  let executable = process.execPath;
  let args: string[];
  let cwd = projectRoot;
  if (mode === "api") {
    executable = resolvePackageBin(projectRoot, "vite");
    args = ["dev", ...extra];
    cwd = join(projectRoot, "apps/auth-api");
  } else if (mode === "remote") {
    args = ["run", "--cwd", join(projectRoot, "remote/api"), "dev", ...extra];
  } else if (mode === "deploy-test") {
    args = [join(projectRoot, "scripts/deploy-auth-api.ts"), "--env", "test", ...extra];
  } else {
    requireDevelopmentValues(environment, ["STRIPE_SECRET_KEY"]);
    args = [
      join(projectRoot, mode === "stripe" ? "scripts/stripe-bootstrap.ts" : "scripts/stripe-flows-e2e.ts"),
      ...extra,
    ];
  }
  const child = spawn(executable, args, {
    cwd,
    env:
      mode === "api" || mode === "remote"
        ? developmentChildEnvironment({ ...developmentSettingsForService(environment, mode), ...process.env }, mode)
        : environment,
    stdio: "inherit",
  });
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  child.once("error", () => {
    process.stderr.write("Could not start the development command. Check the installed dependencies.\n");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Development command setup failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
