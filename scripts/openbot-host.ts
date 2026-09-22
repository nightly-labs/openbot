import { open } from "node:fs/promises";
import { macHostAdminOperations, withHostSetupLock } from "./openbot-host-macos";
import {
  collectHostStatus,
  formatHostStatus,
  type HostAdminOperations,
  parseHostSetup,
  parseHostWatch,
  setupHost,
  verifyHost,
} from "./openbot-host-service";

async function showStatus(operations: HostAdminOperations, json: boolean): Promise<void> {
  const report = await collectHostStatus(operations);
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatHostStatus(report));
}

async function watchStatus(operations: HostAdminOperations, intervalMs: number): Promise<void> {
  const repaint = process.stdout.isTTY;
  for (;;) {
    const report = await collectHostStatus(operations);
    if (repaint) process.stdout.write("\u001B[H\u001B[2J");
    process.stdout.write(`${formatHostStatus(report)}${repaint ? "\nPress Control-C to stop.\n" : "\n"}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(
      "Usage: sudo openbot-host setup [--dry-run] --create-user <name> | --tenant <name> ...\n" +
        "       sudo openbot-host verify\n" +
        "       sudo openbot-host status [--json]\n" +
        "       sudo openbot-host watch [--interval <seconds>]\n",
    );
    return;
  }
  if (process.platform !== "darwin" || process.arch !== "arm64" || process.getuid?.() !== 0)
    throw new Error("Use sudo on an Apple Silicon Mac.");
  const operations = macHostAdminOperations();
  if (command === "--verify-installation" && !args.length) {
    await operations.verifyInstallation();
    process.stdout.write("Host installation verified.\n");
  } else if (command === "setup") {
    const request = parseHostSetup(args);
    if (request.createUsers.length && !request.dryRun) {
      const tty = await open("/dev/tty", "w"); // Refuse before mutation if passwords cannot be shown.
      await tty.close();
    }
    if (request.dryRun) await setupHost(request, operations);
    else await withHostSetupLock(() => setupHost(request, operations));
    process.stdout.write(
      request.dryRun
        ? "Setup checks passed. No accounts or configuration changed.\n"
        : "Host setup complete. Log each tenant into its own Aqua session.\n",
    );
  } else if (command === "verify" && !args.length) {
    const checks = await verifyHost(operations);
    for (const check of checks) process.stdout.write(`[${check.ok ? "PASS" : "FAIL"}] ${check.label}\n`);
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
  } else if (command === "status") {
    if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) throw new Error("Invalid status arguments.");
    await showStatus(operations, args[0] === "--json");
  } else if (command === "watch") {
    await watchStatus(operations, parseHostWatch(args));
  } else throw new Error("Unknown host command.");
}

void main().catch(() => {
  // Native/child-process failures may carry passwords. Do not serialize or log the raw error.
  process.stderr.write(
    "Host command failed. Check installation, account names and permissions. Setup does not overwrite registration. After partial account creation, preserve the root-only credential recovery file under /private/var/root.\n",
  );
  process.exitCode = 1;
});
