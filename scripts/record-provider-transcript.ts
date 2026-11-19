import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentClient } from "../src/backend/agent-client";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    executable: { type: "string" },
    known: { type: "string", default: "" },
  },
});
const provider = values.provider ?? "";
if (!isAgentProvider(provider) || !values.model) {
  throw new Error("Usage: --provider=<provider> --model=<free model id> [--executable=<path>] [--known=<values>]");
}
const model = values.model;
const executable = values.executable ?? execFileSync("which", [provider], { encoding: "utf8" }).trim();
const version = execFileSync(executable, ["--version"], { encoding: "utf8" }).match(/\d+\.\d+\.\d+/)?.[0];
if (!version) throw new Error(`${executable} --version printed no version.`);

const out = resolve(import.meta.dirname, "provider-fakes/transcripts", `${provider}-${version}.jsonl`);
const proxy = resolve(import.meta.dirname, "provider-fakes/transcript-proxy.ts");
const root = await mkdtemp(join(tmpdir(), "openbot-transcript-"));
const workspace = join(root, "workspace");
const home = join(root, "home");
const recording = join(root, "transcript.jsonl");
const wrapper = join(root, "bin", provider);
const known = values.known
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const clients: AgentClient[] = [];

const KEPT_ENV: ReadonlySet<string> = new Set(["PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SHELL"]);
for (const name of Object.keys(process.env)) {
  if (!KEPT_ENV.has(name)) delete process.env[name];
}
process.env.HOME = home;

const recordTurn = async (): Promise<void> => {
  const client = requireProviderDriver(provider).createClient(
    { executable: wrapper, version, source: "managed" },
    120_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  client.start();
  const thread = await startThread(client, { cwd: workspace, model });
  const turn = await runTurn(client, thread, { model, text: "Reply with the word OK and nothing else." });
  if (turn.error) throw new Error(`The turn failed: ${turn.error}`);
};

let failure: string | null = null;
try {
  await mkdir(workspace, { recursive: true });
  await mkdir(home);
  await mkdir(join(root, "bin"));
  await writeFile(recording, `${JSON.stringify({ transcript: 1, provider, version, model })}\n`);
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    wrapper,
    [
      "#!/bin/sh",
      `export HOME=${quote(home)}`,
      "unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME",
      `export TRANSCRIPT_OUT=${quote(recording)}`,
      `export TRANSCRIPT_KNOWN=${quote(JSON.stringify([...known, root]))}`,
      `exec ${quote(process.execPath)} ${quote(proxy)} ${quote(executable)} "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(wrapper, 0o755);

  const error = await recordTurn().then(
    () => null,
    (cause: unknown) => cause,
  );
  await stopClients(clients.splice(0));
  failure = await readFile(`${recording}.failed`, "utf8").catch(() => null);
  if (failure === null && error !== null) throw error;
  if (failure === null) {
    await mkdir(dirname(out), { recursive: true });
    await copyFile(recording, out);
  }
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
}
if (failure !== null) throw new Error(`The recording stopped, and no file was written: ${failure.trim()}`);
process.stdout.write(`Recorded ${out}\n`);
