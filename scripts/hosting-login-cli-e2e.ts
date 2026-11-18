// Drives `openbot login` (scripts/hosting/openbot) in a terminal against a local control socket that
// answers as a server does. It checks the code prompt: the format and the lifetime of the code, an
// empty answer, an expired code and the third wrong code. No account or email is used.
// Linux only: `script` gives the command the terminal that `openbot login` asks for.
// bun scripts/hosting-login-cli-e2e.ts. Writes .openbot-build/hosting-login-cli-e2e/report.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/hosting-login-cli-e2e");
const EMAIL = "owner@example.com";
const GOOD_CODE = "ABCD-2345";
const CODE_LIFETIME_MS = 10 * 60_000;

interface Run {
  name: string;
  input: string[];
  exitCode: number | null;
  output: string;
  requests: string[];
}

async function body(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function lines(values: Record<string, string | number>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
}

/** A control socket that sends challenge `c1`, `c2`, ... and accepts `GOOD_CODE` for the latest one. */
async function controlServer(socket: string, requests: string[]) {
  let challenges = 0;
  let signedIn = false;
  const server = createServer((request, response) => {
    void (async () => {
      const form = await body(request);
      const route = `${request.method} ${request.url}`;
      const code = form.get("code");
      requests.push(code === null ? route : `${route} ${form.get("challenge")} ${code}`);
      const answer = (status: number, values: Record<string, string | number>) => {
        response.writeHead(status, { "content-type": "text/plain" }).end(lines(values));
      };
      if (route === "GET /v1/status")
        return answer(
          200,
          signedIn ? { account: "signed_in", email: EMAIL, server: "online" } : { account: "signed_out" },
        );
      if (route === "POST /v1/login/start") {
        challenges += 1;
        return answer(200, { challenge: `c${challenges}`, expires_at: Date.now() + CODE_LIFETIME_MS });
      }
      if (route === "POST /v1/login/verify") {
        // As the server: an empty code is a bad request with no message of its own.
        if (!code?.trim()) return answer(400, { error: "invalid_request" });
        if (code === "OLD")
          return answer(400, {
            error: "sign_in_code_expired",
            message: "The sign-in code expired. Request a new code.",
          });
        if (code === GOOD_CODE && form.get("challenge") === `c${challenges}`) {
          signedIn = true;
          return answer(200, { account: "signed_in", email: EMAIL, server: "online" });
        }
        return answer(400, { error: "invalid_sign_in_code", message: "The sign-in code is not correct." });
      }
      return answer(404, { error: "not_found" });
    })().catch((error: unknown) => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>((done) => server.listen(socket, done));
  return { close: () => new Promise<void>((done) => server.close(() => done())) };
}

async function login(name: string, socket: string, input: string[]): Promise<Run> {
  const requests: string[] = [];
  const server = await controlServer(socket, requests);
  try {
    const command = `bash ${JSON.stringify(join(ROOT, "scripts/hosting/openbot"))} login ${EMAIL}`;
    const child = spawn("script", ["--quiet", "--return", "--command", command, "/dev/null"], {
      env: { ...process.env, OPENBOT_CONTROL_SOCKET: socket, TERM: "dumb" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    // The terminal keeps the lines until each `read` takes one.
    child.stdin.write(`${input.join("\n")}\n`);
    const exitCode = await new Promise<number | null>((done) => child.on("close", done));
    return { name, input, exitCode, output: output.replaceAll("\r", ""), requests };
  } finally {
    await server.close();
  }
}

const verified = (run: Run) => run.requests.filter((request) => request.startsWith("POST /v1/login/verify"));
const started = (run: Run) => run.requests.filter((request) => request === "POST /v1/login/start");

const root = await mkdtemp(join(tmpdir(), "openbot-login-cli-"));
const runs: Run[] = [];
const report: { passed: boolean; runs: Run[]; failures: string[] } = { passed: false, runs, failures: [] };

try {
  const recovered = await login("an empty answer, then an expired code, then a new code", join(root, "a.sock"), [
    "",
    "OLD",
    "y",
    GOOD_CODE,
  ]);
  runs.push(recovered);
  assert.equal(recovered.exitCode, 0, recovered.output);
  assert.match(recovered.output, /8 characters/u, "The prompt names the length of the code.");
  assert.match(recovered.output, /expires in (9|10) minutes/u, "The prompt names the lifetime of the code.");
  assert.deepEqual(
    verified(recovered),
    ["POST /v1/login/verify c1 OLD", `POST /v1/login/verify c2 ${GOOD_CODE}`],
    "An empty answer is not sent, and the good code goes with the new challenge.",
  );
  assert.equal(started(recovered).length, 2, "An expired code offers a new code.");
  assert.match(recovered.output, /Signed in as owner@example\.com/u);

  const refused = await login("three wrong codes, then no new code", join(root, "b.sock"), ["X1", "X2", "X3", "n"]);
  runs.push(refused);
  assert.equal(refused.exitCode, 1, refused.output);
  assert.equal(verified(refused).length, 3);
  assert.equal(started(refused).length, 1, "No new code is sent when the user says no.");
  assert.match(refused.output, /Run openbot login again/u, "The end names the next step.");

  report.passed = true;
} catch (error) {
  report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${runs.length} runs. Report: ${join(OUT, "report.json")}\n`);
if (!report.passed) {
  process.stderr.write(`${report.failures.join("\n")}\n`);
  process.exit(1);
}
