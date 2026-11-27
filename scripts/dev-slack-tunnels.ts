import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

import { closeTunnels, openTunnel, signalTunnelUrl, type TunnelledSpec } from "./dev-tunnels";

const logger = createOpenBotLogger("dev-slack");

const SLACK_FILE = ".env.slack-dev";
const SLACK_KEYS = ["OPENBOT_DEV_SLACK_SIGNING_SECRET"] as const;
const DEVELOPMENT_SLACK_APP_ID = "A0C5G5XGS83";

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
  const close = closeTunnels(tunnels);
  process.once("exit", close);
  try {
    const [signalUrl, apiUrl] = await Promise.all([openTunnel(signalPort, tunnels), openTunnel(apiPort, tunnels)]);
    const tunnelled = {
      REMOTE_SIGNAL_URL: signalTunnelUrl(signalUrl),
      SLACK_DEV_PUBLIC_ORIGIN: apiUrl,
      OPENBOT_DEV_SLACK_CALLBACK_PORT: callbackPort,
    };
    for (const spec of specs) {
      Object.assign(spec.env, tunnelled);
      if (spec.name === "remote")
        spec.env.SLACK_SIGNING_SECRET = `${DEVELOPMENT_SLACK_APP_ID}:${values.OPENBOT_DEV_SLACK_SIGNING_SECRET}`;
    }
    logger.info(
      `Set the development Slack app's request URL to ${signalUrl}/v1/slack/events and its redirect URL to ${apiUrl}/v2/slack/callback.`,
    );
    return close;
  } catch (error) {
    close();
    throw error;
  }
}

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
