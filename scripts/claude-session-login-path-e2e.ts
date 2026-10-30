// Adapted from the reproduction in nightly-labs/openbot#2464.
// A Claude agent session with OpenBot started the way Finder, the Dock or a login item starts it:
// PATH=/usr/bin:/bin:/usr/sbin:/sbin. The session's Bash tool and hooks run with the PATH the Claude
// process starts with, so that process must get the login shell's folders, such as Homebrew's.
// The real Claude Agent SDK starts a stand-in Claude executable that records its PATH.
// `bun run test:claude:login-path`; exit 0 = the session got the login-shell folder. Writes
// .openbot-build/claude-session-login-path-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { runInLoginShell } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-session-login-path-e2e");
const report: { passed: boolean; sessionPath?: string; error?: string } = { passed: false };

const root = await mkdtemp(join(tmpdir(), "openbot-claude-login-path-e2e-"));
let client: ClaudeAgentClient | null = null;
let passed = false;

try {
  // The user's login shell puts a tool folder on PATH, as Homebrew's `brew shellenv` or nvm does.
  const home = join(root, "home");
  const tools = join(home, "tools");
  await mkdir(tools, { recursive: true });
  const profile = `export PATH="${tools}:$PATH"\n`;
  for (const name of [".zprofile", ".zshrc", ".bash_profile", ".profile"]) await writeFile(join(home, name), profile);
  process.env.HOME = home;
  delete process.env.ZDOTDIR;
  if (process.platform !== "darwin") process.env.SHELL = "/bin/bash";

  // OpenBot started from Finder, the Dock or a login item.
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

  const shellPath = await runCauseEffect(runInLoginShell('printf %s "$PATH"'));
  assert.ok(shellPath.includes(tools), "Precondition: the login shell puts the tool folder on PATH.");

  // The stand-in records the PATH it started with, then waits until the SDK closes its input.
  const recorded = join(root, "session-path.txt");
  const executable = join(root, "claude");
  await writeFile(
    executable,
    `#!/bin/sh\nprintf %s "$PATH" > "${recorded}.tmp"\nmv "${recorded}.tmp" "${recorded}"\nexec cat > /dev/null\n`,
  );
  await chmod(executable, 0o755);
  const workspace = join(root, "workspace");
  await mkdir(workspace);

  client = new ClaudeAgentClient({ executable, version: "2.1.302", source: "system" });
  client.start();
  await runCauseEffect(client.request("thread/start", { cwd: workspace, persistSession: false }, (value) => value));

  // The SDK starts the process when the query is made; wait for the file it writes.
  const sessionPath = await new Promise<string>((done, fail) => {
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      fail(new Error("The Claude process did not start."));
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
  report.sessionPath = sessionPath;
  assert.ok(sessionPath.split(":").includes(tools), "The Claude session starts with the login-shell folder.");
  passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (client) await runCauseEffect(client.stop()).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

report.passed = passed;
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(passed ? 0 : 1);
