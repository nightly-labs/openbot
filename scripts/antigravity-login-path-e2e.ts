import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { type AntigravityCliInfo, resolveAntigravityCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-login-path-e2e");
const ROOT_VARIABLE = "OPENBOT_ANTIGRAVITY_LOGIN_PATH_E2E_ROOT";
const MCP_COMMAND = "openbot-e2e-mcp-server";

if (process.env[ROOT_VARIABLE] === undefined) {
  const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-login-path-e2e-"));
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  await writeFile(join(home, ".bash_profile"), `export PATH="${join(home, "tools")}:/usr/bin:/bin"\n`);
  for (const name of [".zprofile", ".zshrc", ".profile"]) await writeFile(join(home, name), "");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [ROOT_VARIABLE]: root,
    HOME: home,
    SHELL: "/bin/bash",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  };
  delete env.ZDOTDIR;
  const child = spawnSync(process.execPath, [import.meta.filename], { stdio: "inherit", env });
  await rm(root, { recursive: true, force: true });
  process.exit(child.status ?? 1);
}

const root = process.env[ROOT_VARIABLE];
interface Case {
  launchPath: string | null;
  mcpServerPath: string;
}
interface Report {
  passed: boolean;
  cases: { managed?: Case; userPath?: Case };
  error?: string;
}
const report: Report = { passed: false, cases: {} };
const clients: AgentClient[] = [];
let passed = false;

async function mcpServerRun(cli: AntigravityCliInfo, recorded: string): Promise<string> {
  await rm(recorded, { force: true });
  const client = requireProviderDriver("antigravity").createClient(cli, 30_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const path = await new Promise<string>((done, fail) => {
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      fail(new Error("The Antigravity server process did not start."));
    }, 10_000);
    const poll = () =>
      readFile(recorded, "utf8").then(
        (text) => {
          clearTimeout(deadline);
          done(text);
        },
        () => {
          if (!expired) setTimeout(poll, 50);
        },
      );
    poll();
  });
  await runCauseEffect(client.stop());
  return path;
}

try {
  assert.notEqual(process.platform, "win32", "Windows has no login shell; this script covers macOS and Linux.");
  const tools = join(root, "home", "tools");
  const recorded = join(root, "mcp-server.txt");

  await mkdir(tools, { recursive: true });
  const mcpCommand = join(tools, MCP_COMMAND);
  await writeFile(mcpCommand, `#!/bin/sh\nprintf %s "$PATH" > "${recorded}.tmp"\nmv "${recorded}.tmp" "${recorded}"\n`);
  await chmod(mcpCommand, 0o755);

  const server = join(root, "antigravity", "1.5.4", "bin", "antigravity");
  await mkdir(dirname(server), { recursive: true });
  await writeFile(
    server,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo 1.5.4; exit 0; fi',
      `${MCP_COMMAND} || { printf 'missing: %s' "$PATH" > "${recorded}.tmp"; mv "${recorded}.tmp" "${recorded}"; }`,
      "exec cat > /dev/null",
      "",
    ].join("\n"),
  );
  await chmod(server, 0o755);

  const managed = await runCauseEffect(resolveAntigravityCli({ systemCandidates: [], bundledExecutable: server }));
  assert.equal(managed.source, "managed");
  const managedRun = await mcpServerRun(managed, recorded);
  report.cases.managed = { launchPath: managed.launchPath ?? null, mcpServerPath: managedRun };
  assert.ok(!managedRun.startsWith("missing"), "The MCP command is found on the login shell's PATH.");
  assert.ok(managedRun.split(":").includes(tools), "The MCP command starts with the login PATH.");
  assert.ok(!managedRun.split(":").includes(dirname(server)), "The managed server's folder is not on the PATH.");

  const userPath = await runCauseEffect(resolveAntigravityCli({ systemCandidates: [server] }));
  assert.equal(userPath.source, "system");
  const userRun = await mcpServerRun(userPath, recorded);
  report.cases.userPath = { launchPath: userPath.launchPath ?? null, mcpServerPath: userRun };
  assert.ok(!userRun.startsWith("missing"), "The MCP command is found on the login shell's PATH.");
  assert.ok(userRun.split(":").includes(tools), "The MCP command starts with the login PATH.");
  assert.ok(userRun.split(":").includes(dirname(server)), "The user's server folder is on the PATH.");
  passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  for (const client of clients) await runCauseEffect(client.stop()).catch(() => undefined);
}

report.passed = passed;
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(passed ? 0 : 1);
