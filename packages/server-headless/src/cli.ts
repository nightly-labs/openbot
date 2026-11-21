// openbot-headless CLI: drives the headless server over its control socket, the same
// way /opt/OpenBot/hosted/openbot drives the packaged server. Usage:
//
//   bun packages/server-headless/src/cli.ts status
//   bun packages/server-headless/src/cli.ts login you@example.com
//   bun packages/server-headless/src/cli.ts logout
//
// Speaks the native dialect: memory_available/memory_limit arrive in BYTES and the CLI
// prints MiB, like the packaged CLI. Error lines keep the official wording where a
// direct equivalent exists.

import { join } from "node:path";

const socketDir = process.env.OPENBOT_HEADLESS_CONTROL_DIR ?? "/run/openbot-headless-test";
const socketPath = join(socketDir, "control.sock");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function control(method: string, path: string, body?: URLSearchParams): Promise<Map<string, string>> {
  const payload = body ? [...body.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
  const args = ["-sS", "--max-time", "120", "--unix-socket", socketPath];
  if (body) args.push("-X", method, "--data-binary", "@-", "-H", "content-type: application/x-www-form-urlencoded");
  else args.push("-X", method);
  args.push(`http://openbot${path}`);
  let proc;
  try {
    proc = Bun.spawn(["curl", ...args], { stdin: payload ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe" });
  } catch {
    fail("The headless server does not answer. Start it with: bun packages/server-headless/src/main.ts");
  }
  if (payload) {
    proc.stdin!.write(payload);
    proc.stdin!.end();
  }
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) fail("The headless server does not answer. Start it with: bun packages/server-headless/src/main.ts");
  const lines = new Map<string, string>();
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) lines.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return lines;
}

const MIB = 1024 * 1024;

function accountMessage(lines: Map<string, string>): string {
  const error = lines.get("error");
  switch (error) {
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_request":
      return "Enter the sign-in code.";
    case "signed_in":
      return "This server is signed in. To use another account, run: openbot-headless logout";
    default:
      return `OpenBot refused the request (${error ?? "unknown"}).`;
  }
}

const command = process.argv[2] ?? "status";

switch (command) {
  case "status": {
    const s = await control("GET", "/v1/status");
    console.log(`openbot-headless ${s.get("version") ?? "?"}`);
    console.log(`Account: ${s.get("account") ?? "?"}${s.get("email") ? ` (${s.get("email")})` : ""}`);
    console.log(`Server: ${s.get("server_name") ?? "(no name)"} (${s.get("server") ?? "?"})`);
    const free = Number(s.get("memory_available") ?? "0") / MIB;
    const total = Number(s.get("memory_limit") ?? "0") / MIB;
    console.log(`Memory: ${Math.round(free)} MiB free of ${Math.round(total)} MiB (${s.get("memory_level")})`);
    console.log(`Turns at the same time: at most ${s.get("turn_limit") ?? "?"}`);
    break;
  }
  case "login": {
    const email = process.argv[3];
    if (!email) fail("Usage: cli.ts login <email>");
    const started = await control("POST", "/v1/login/start", new URLSearchParams({ email }));
    if (started.get("error")) fail(accountMessage(started));
    const challenge = started.get("challenge") ?? fail("No challenge from the server.");
    console.log(`A sign-in code was sent to ${email}.`);
    process.stdout.write("Enter the code: ");
    const code = (await new Response(Bun.stdin).text()).trim();
    if (!code) fail("No code entered.");
    const verified = await control("POST", "/v1/login/verify", new URLSearchParams({ challenge, code }));
    if (verified.get("account") === "signed_in") {
      console.log(`Signed in as ${verified.get("email")}.`);
    } else if (verified.get("error")) {
      fail(accountMessage(verified));
    } else {
      fail(`Sign-in did not complete: ${verified.get("account") ?? "unknown"}`);
    }
    break;
  }
  case "logout": {
    const s = await control("POST", "/v1/logout");
    console.log(`Account: ${s.get("account")}`);
    break;
  }
  default:
    fail(`Unknown command: ${command}. Use: status | login <email> | logout`);
}
