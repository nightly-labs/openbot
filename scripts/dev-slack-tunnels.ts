// `bun run dev:slack`: the dev stack, reachable by Slack. Slack posts the events of every workspace
// that installed the OpenBot app to Signal, and it accepts only a public HTTPS address. So this opens
// a `cloudflared` quick tunnel to the local Signal and gives it the development Slack app's signing
// secret. The tunnel lives as long as this process. Set the development app's request URL (event
// subscriptions and interactivity) to the printed address; it changes at each start.
//
// `.env.slack-dev` in the worktree root holds the Slack value. Git ignores it:
//
//   OPENBOT_DEV_SLACK_SIGNING_SECRET='…'   (the development app, api.slack.com/apps > Basic Information)
//
// The install needs an account API that Slack can send the browser back to over HTTPS: use the test
// Worker (`bun run deploy:test`) with the development app's `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
 * Opens the tunnel to Signal and points every service of the stack at it. Returns the function that
 * closes it. Stops the start when the tunnel or the signing secret is missing: a stack that Slack
 * cannot reach would look like a bug in the app.
 */
export async function attachSlackTunnels(specs: TunnelledSpec[], projectRoot: string): Promise<() => void> {
  const file = join(projectRoot, SLACK_FILE);
  const values = readSlackDevelopmentValues(existsSync(file) ? readFileSync(file, "utf8") : "", process.env);
  if (!values.OPENBOT_DEV_SLACK_SIGNING_SECRET) {
    throw new Error(`--slack needs OPENBOT_DEV_SLACK_SIGNING_SECRET in ${SLACK_FILE} or the shell.`);
  }
  const signalPort = specs.find((spec) => spec.name === "remote")?.env.REMOTE_SIGNAL_PORT;
  if (!signalPort || !specs.some((spec) => spec.name === "app"))
    throw new Error("--slack needs Signal and the app: use the app or all target.");

  const tunnels: ChildProcess[] = [];
  const close = () => {
    for (const tunnel of tunnels) if (tunnel.exitCode === null) tunnel.kill("SIGTERM");
  };
  process.once("exit", close);
  try {
    const signalUrl = await openTunnel(signalPort, tunnels);
    const tunnelled = {
      REMOTE_SIGNAL_URL: `${signalUrl.replace("https://", "wss://")}/v1/signal`,
      SLACK_SIGNING_SECRET: values.OPENBOT_DEV_SLACK_SIGNING_SECRET,
    };
    for (const spec of specs) Object.assign(spec.env, tunnelled);
    logger.info(`Set the development Slack app's request URL to ${signalUrl}/v1/slack/events.`);
    return close;
  } catch (error) {
    close();
    throw error;
  }
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
