// openbot-headless CLI: drives the headless server over its control socket, the same
// way /opt/OpenBot/hosted/openbot drives the packaged server. Usage:
//
//   bun packages/server-headless/src/cli.ts status
//   bun packages/server-headless/src/cli.ts login you@example.com
//   bun packages/server-headless/src/cli.ts logout
//
// The login prints the challenge, waits for the emailed code, and verifies it.

import { join } from "node:path";

const socketDir = process.env.OPENBOT_HEADLESS_CONTROL_DIR ?? "/run/openbot-headless-test";
const socketPath = join(socketDir, "control.sock");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function control(method: string, path: string, body?: URLSearchParams): Promise<Map<string, string>> {
  // curl handles unix sockets cleanly; reuse the same tooling as the packaged CLI.
  const payload = body ? [...body.entries()].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
  const args = ["-sS", "--max-time", "120", "--unix-socket", socketPath];
  if (body) args.push("-X", method, "--data-binary", "@-", "-H", "content-type: application/x-www-form-urlencoded");
  else args.push("-X", method);
  args.push(`http://openbot${path}`);
  const proc = Bun.spawn(["curl", ...args], {
    stdin: payload ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (payload) {
    proc.stdin.write(payload);
    proc.stdin.end();
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

const command = process.argv[2] ?? "status";

switch (command) {
  case "status": {
    const s = await control("GET", "/v1/status");
    console.log(`openbot-headless ${s.get("version") ?? "?"}`);
    console.log(`Account: ${s.get("account") ?? "?"}${s.get("email") ? ` (${s.get("email")})` : ""}`);
    console.log(`Server: ${s.get("server_name") ?? "?"} (${s.get("server") ?? "?"})`);
    console.log(`Memory: ${s.get("memory_free_mib")} MiB free of ${s.get("memory_total_mib")} MiB (${s.get("memory_level")})`);
    break;
  }
  case "login": {
    const email = process.argv[3];
    if (!email) fail("Usage: cli.ts login <email>");
    const started = await control("POST", "/v1/login/start", new URLSearchParams({ email }));
    if (started.get("error")) fail(`Login failed: ${started.get("error")}`);
    const challenge = started.get("challenge") ?? fail("No challenge from the server.");
    console.log(`A sign-in code was sent to ${email}.`);
    process.stdout.write("Enter the code: ");
    const code = (await new Response(Bun.stdin).text()).trim();
    if (!code) fail("No code entered.");
    const verified = await control("POST", "/v1/login/verify", new URLSearchParams({ challenge, code }));
    if (verified.get("account") === "signed_in") {
      console.log(`Signed in as ${verified.get("email")}.`);
    } else {
      fail(`Sign-in failed: ${verified.get("error") ?? verified.get("account") ?? "unknown"}`);
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
