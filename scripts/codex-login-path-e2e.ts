// Adapted from the report in nightly-labs/openbot#2686: "Codex CLI reports 'not found'".
// OpenBot started the way Finder, the Dock or a login item starts it: PATH=/usr/bin:/bin:/usr/sbin:/sbin.
// An npm Codex is a `#!/usr/bin/env node` script, so `codex --version` and the app-server process
// must run with the login shell's folders, or with the folder that Codex was found in.
// The stand-in Codex runs on a stand-in interpreter that is only in those folders. The login shell
// is bash, set in $SHELL, and only `~/.bash_profile` adds the folder: zsh does not see it.
// Bun reads HOME once, at start, so the cases run in a second process that starts with the stand-in
// home. `bun run test:codex:login-path`; exit 0 = every case passed. Writes
// .openbot-build/codex-login-path-e2e/report.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { providerFailureStatus } from "../src/backend/agent/provider-status";
import type { AgentClient } from "../src/backend/agent-client";
import { type CodexCliInfo, resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-login-path-e2e");
const ROOT_VARIABLE = "OPENBOT_CODEX_LOGIN_PATH_E2E_ROOT";

if (process.env[ROOT_VARIABLE] === undefined) {
  const root = await mkdtemp(join(tmpdir(), "openbot-codex-login-path-e2e-"));
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  // Only bash's login profile adds the folder, as for a user whose shell is bash. It also leaves out
  // the system folders that /etc/profile adds, so a Codex installed on this computer is not found.
  await writeFile(join(home, ".bash_profile"), `export PATH="${join(home, "tools")}:/usr/bin:/bin"\n`);
  for (const name of [".zprofile", ".zshrc", ".profile"]) await writeFile(join(home, name), "");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [ROOT_VARIABLE]: root,
    HOME: home,
    SHELL: "/bin/bash",
    // OpenBot started from Finder, the Dock or a login item.
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  };
  delete env.ZDOTDIR;
  delete env.OPENBOT_CODEX_PATH;
  const child = spawnSync(process.execPath, [import.meta.filename], { stdio: "inherit", env });
  await rm(root, { recursive: true, force: true });
  process.exit(child.status ?? 1);
}

const root = process.env[ROOT_VARIABLE];
type Status = ReturnType<typeof providerFailureStatus>;
interface Report {
  passed: boolean;
  cases: {
    loginPath?: { executable: string; version: string; sessionPath: string };
    fallbackFolder?: { executable: string; sessionPath: string };
    statusMessages?: { managed: Status; system: Status; missing: Status };
  };
  error?: string;
}
const report: Report = { passed: false, cases: {} };
const clients: AgentClient[] = [];
let passed = false;

/** An interpreter at `folder/name`, and a Codex in `codexFolder` that `#!/usr/bin/env name` runs. */
async function writeStandIn(folder: string, name: string, codexFolder: string, recorded: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  await mkdir(codexFolder, { recursive: true });
  const interpreter = join(folder, name);
  await writeFile(interpreter, '#!/bin/sh\nexec /bin/sh "$@"\n');
  await chmod(interpreter, 0o755);
  const codex = join(codexFolder, "codex");
  await writeFile(
    codex,
    [
      `#!/usr/bin/env ${name}`,
      'if [ "$1" = "--version" ]; then echo "codex-cli 0.200.0"; exit 0; fi',
      `printf %s "$PATH" > "${recorded}.tmp"`,
      `mv "${recorded}.tmp" "${recorded}"`,
      "exec cat > /dev/null",
      "",
    ].join("\n"),
  );
  await chmod(codex, 0o755);
  return codex;
}

/** Starts the app-server process through the Codex driver, and returns the PATH it started with. */
async function appServerPath(cli: CodexCliInfo, recorded: string): Promise<string> {
  const client = requireProviderDriver("codex").createClient(cli, 30_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  return await new Promise<string>((done, fail) => {
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      fail(new Error("The Codex app-server process did not start."));
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
}

try {
  assert.notEqual(process.platform, "win32", "Windows has no login shell; this script covers macOS and Linux.");
  const home = join(root, "home");
  const tools = join(home, "tools");

  // 1. A Codex on the login shell's PATH, whose interpreter is only there.
  const loginRecorded = join(root, "login-path.txt");
  const loginCodex = await writeStandIn(tools, "openbot-e2e-node", tools, loginRecorded);
  const loginCli = await runCauseEffect(resolveCodexCli({ bundledExecutable: null }));
  assert.equal(loginCli.executable, loginCodex, "Codex is found on the login shell's PATH from $SHELL.");
  assert.equal(loginCli.version, "0.200.0", "`codex --version` runs with the login shell's PATH.");
  const loginSession = await appServerPath(loginCli, loginRecorded);
  assert.ok(loginSession.split(":").includes(tools), "The app-server process starts with the login PATH.");
  report.cases.loginPath = { executable: loginCli.executable, version: loginCli.version, sessionPath: loginSession };

  // 2. A Volta Codex that the login shell's PATH does not name. Its interpreter is beside it only.
  await rm(loginCodex);
  const volta = join(home, ".volta", "bin");
  const voltaRecorded = join(root, "volta-path.txt");
  const voltaCodex = await writeStandIn(volta, "openbot-e2e-volta-node", volta, voltaRecorded);
  const voltaCli = await runCauseEffect(resolveCodexCli({ bundledExecutable: null }));
  assert.equal(voltaCli.executable, voltaCodex, "Codex is found in the Volta fallback folder.");
  const voltaSession = await appServerPath(voltaCli, voltaRecorded);
  assert.ok(voltaSession.split(":").includes(volta), "The app-server process starts with Codex's own folder.");
  report.cases.fallbackFolder = { executable: voltaCli.executable, sessionPath: voltaSession };

  // 3. The status names the copy that failed, the download or the user's own, in catalog text.
  const broken = join(root, "broken-codex");
  await writeFile(broken, "#!/bin/sh\nexit 1\n");
  await chmod(broken, 0o755);
  const failure = async (input: Parameters<typeof resolveCodexCli>[0]) => {
    // The lookup must fail. If it finds a CLI, the run fails here.
    const error = await Effect.runPromise(Effect.flip(resolveCodexCli(input)));
    return providerFailureStatus("codex", error.cause, null);
  };
  const managed = await failure({ systemCandidates: [], bundledExecutable: broken });
  assert.deepEqual(managed, {
    state: "error",
    version: null,
    message: sourceText("error.provider.codexManagedNotStarted"),
  });
  const system = await failure({ systemCandidates: [broken], bundledExecutable: null });
  assert.deepEqual(system, {
    state: "error",
    version: null,
    message: sourceText("error.provider.codexNotStartedHint"),
  });
  const missing = await failure({ systemCandidates: [], bundledExecutable: null });
  assert.deepEqual(missing, { state: "error", version: null, message: sourceText("error.provider.codexMissing") });
  report.cases.statusMessages = { managed, system, missing };
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
