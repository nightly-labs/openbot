import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { startAcpAuthentication } from "../src/backend/acp-sign-in";

const OUT = resolve(import.meta.dirname, "../.openbot-build/acp-sign-in-errors-e2e");
const TIMEOUT_MS = 1_500;

const FAKE_AGENT = `
const NL = String.fromCharCode(10);
const mode = process.argv[2];
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (mode === "silent") continue;
    if (message.method === "initialize")
      write({ id: message.id, result: { protocolVersion: 1, authMethods: [{ id: "oauth-personal", name: "Google" }], agentCapabilities: {} } });
    else if (message.method === "authenticate" && mode === "no-browser")
      write({ id: message.id, error: { code: -32603, message: "No browser is available here (no graphical display is available to open a browser). Run \`agy acp --login\` in a terminal on this machine, then retry; or use a Gemini API key." } });
  }
});
setInterval(() => {}, 1000);
`;

const CASES = [
  { mode: "silent", expected: sourceText("error.provider.acpSignInNoStart") },
  { mode: "no-browser", expected: sourceText("error.provider.geminiNoBrowserUseCode") },
  { mode: "waits", expected: sourceText("error.provider.acpSignInTimedOut") },
] as const;

interface CaseReport {
  mode: string;
  error: string | null;
  passed: boolean;
}

const root = await mkdtemp(join(tmpdir(), "openbot-acp-sign-in-errors-e2e-"));
const report: { passed: boolean; cases: CaseReport[]; error?: string } = { passed: false, cases: [] };

async function signIn(fake: string, mode: string): Promise<string | null> {
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const login = yield* startAcpAuthentication({
          executable: process.execPath,
          argv: [fake, mode],
          env: {},
          methodId: "oauth-personal",
          timeoutMs: TIMEOUT_MS,
        });
        yield* login.done;
      }),
    ),
  );
  if (exit._tag === "Success") return null;
  const failure = exit.cause.toString();
  return CASES.map((entry) => entry.expected).find((message) => failure.includes(message)) ?? failure.slice(0, 300);
}

try {
  const fake = join(root, "fake-agent.cjs");
  await writeFile(fake, FAKE_AGENT);
  for (const entry of CASES) {
    const error = await signIn(fake, entry.mode);
    report.cases.push({ mode: entry.mode, error, passed: error === entry.expected });
    assert.equal(error, entry.expected, `${entry.mode}: the sign-in names its stage`);
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
