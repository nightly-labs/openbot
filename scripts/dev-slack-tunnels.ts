// `bun run dev:slack`: the dev stack, reachable by Slack. Slack accepts only public HTTPS addresses,
// so this opens two `cloudflared` quick tunnels: one to the local Signal, which takes the
// development Slack app's events, and one to the local account API, which takes the install's
// return. The dev app gets a loopback port for the end of the install, so the grant reaches it and
// not an installed OpenBot that owns `openbot://`. The tunnels live as long as this process. Their
// addresses change at each start: the development app's request and redirect URLs must follow.
//
// `.env.slack-dev` in the worktree root holds the signing secret, and `apps/auth-api/.env.dev` the
// development app's `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_STATE_SECRET`. Git ignores
// both:
//
//   OPENBOT_DEV_SLACK_SIGNING_SECRET='…'   (the development app, api.slack.com/apps > Basic Information)

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("dev-slack");

const SLACK_FILE = ".env.slack-dev";
const SLACK_KEYS = ["OPENBOT_DEV_SLACK_SIGNING_SECRET"] as const;
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u;
const TUNNEL_TIMEOUT_MS = 45_000;

interface TunnelledSpec {
  name: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Reads the Slack values: `KEY=value` or `export KEY='value'` lines, and only the keys above. A
 * value set in the shell wins over the file.
 */
export function readSlackDevelopmentValues(text: string, environment: NodeJS.ProcessEnv): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/u.exec(line);
    const key = match?.[1];
    if (!key || !SLACK_KEYS.some((allowed) => allowed === key)) continue;
    values[key] = (match[2] ?? "").replace(/^(['"])(.*)\1$/u, "$2");
  }
  for (const key of SLACK_KEYS) {
    const fromShell = environment[key];
    if (fromShell) values[key] = fromShell;
  }
  return values;
}

/**
 * Opens the tunnels and points every service of the stack at them. Returns the function that closes
 * them. Stops the start when a tunnel or the signing secret is missing: a stack that Slack cannot
 * reach would look like a bug in the app.
 */
export async function attachSlackTunnels(specs: TunnelledSpec[], projectRoot: string): Promise<() => void> {
  const file = join(projectRoot, SLACK_FILE);
  const values = readSlackDevelopmentValues(existsSync(file) ? readFileSync(file, "utf8") : "", process.env);
  if (!values.OPENBOT_DEV_SLACK_SIGNING_SECRET) {
    throw new Error(`--slack needs OPENBOT_DEV_SLACK_SIGNING_SECRET in ${SLACK_FILE} or the shell.`);
  }
  const signalPort = specs.find((spec) => spec.name === "remote")?.env.REMOTE_SIGNAL_PORT;
  const apiPort = specs.find((spec) => spec.name === "api")?.env.OPENBOT_API_PORT;
  if (!signalPort || !apiPort || !specs.some((spec) => spec.name === "app"))
    throw new Error("--slack needs Signal, the account API and the app: use the app or all target.");
  const callbackPort = String(await freePort());

  const tunnels: ChildProcess[] = [];
  const close = () => {
    for (const tunnel of tunnels) if (tunnel.exitCode === null) tunnel.kill("SIGTERM");
  };
  process.once("exit", close);
  try {
    const [signalUrl, apiUrl] = await Promise.all([openTunnel(signalPort, tunnels), openTunnel(apiPort, tunnels)]);
    const tunnelled = {
      REMOTE_SIGNAL_URL: `${signalUrl.replace("https://", "wss://")}/v1/signal`,
      SLACK_SIGNING_SECRET: values.OPENBOT_DEV_SLACK_SIGNING_SECRET,
      SLACK_DEV_PUBLIC_ORIGIN: apiUrl,
      OPENBOT_DEV_SLACK_CALLBACK_PORT: callbackPort,
    };
    for (const spec of specs) Object.assign(spec.env, tunnelled);
    logger.info(
      `Set the development Slack app's request URL to ${signalUrl}/v1/slack/events and its redirect URL to ${apiUrl}/v2/slack/callback.`,
    );
    return close;
  } catch (error) {
    close();
    throw error;
  }
}

/** A loopback port that nothing listens on now. The dev app binds it when it starts. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("No free port for the Slack install listener."))));
    });
  });
}

function openTunnel(port: string, tunnels: ChildProcess[]): Promise<string> {
  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  tunnels.push(tunnel);
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => fail(new Error(`cloudflared did not open a tunnel to port ${port}.`)),
      TUNNEL_TIMEOUT_MS,
    );
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_192);
      const url = TUNNEL_URL.exec(output)?.[0];
      if (!url) return;
      clearTimeout(timer);
      tunnel.stdout?.off("data", read);
      tunnel.stderr?.off("data", read);
      // Keep draining, so a full pipe never stops the tunnel.
      tunnel.stdout?.resume();
      tunnel.stderr?.resume();
      resolve(url);
    };
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    tunnel.stdout?.on("data", read);
    tunnel.stderr?.on("data", read);
    tunnel.once("error", () =>
      fail(new Error("cloudflared is not installed. Install it with `brew install cloudflared`.")),
    );
    tunnel.once("exit", (code) => fail(new Error(`cloudflared stopped with code ${code ?? "unknown"}.`)));
  });
}
