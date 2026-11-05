import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Effect } from "effect";
import { usableMcpServer } from "../src/backend/mcp-provider-shapes";

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-shell-"));
try {
  const bin = join(root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "npx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const shell = join(root, "zsh");
  await writeFile(shell, "#!/bin/sh\nprintf '\\033]1337;ShellIntegration\\007'\nexec /bin/sh -c \"$2\"\n", {
    mode: 0o755,
  });
  process.env.SHELL = shell;
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  const result = await Effect.runPromise(
    usableMcpServer({
      id: "",
      name: "test",
      transport: "stdio",
      enabled: true,
      command: "npx",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: "",
      headers: [],
    }),
  );
  assert.equal(result.command, join(bin, "npx"));
  assert.equal(result.path?.split(delimiter)[0], bin);
  execFileSync(result.command);
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(".openbot-build/mcp-noisy-shell-e2e.json", JSON.stringify({ passed: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
