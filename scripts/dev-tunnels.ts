import { type ChildProcess, spawn } from "node:child_process";
import { createOpenBotLogger } from "@openbot/logging";

import { developmentChildEnvironment } from "./development-environment";

const logger = createOpenBotLogger("dev-tunnel");

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/u;
const TUNNEL_TIMEOUT_MS = 45_000;

export interface TunnelledSpec {
  name: string;
  env: NodeJS.ProcessEnv;
}

export function signalTunnelUrl(origin: string): string {
  return `${origin.replace("https://", "wss://")}/v1/signal`;
}

export async function attachMobileTunnels(specs: TunnelledSpec[]): Promise<() => void> {
  const signalPort = specs.find((spec) => spec.name === "remote")?.env.REMOTE_SIGNAL_PORT;
  const apiPort = specs.find((spec) => spec.name === "api")?.env.OPENBOT_API_PORT;
  if (!signalPort || !apiPort || !specs.some((spec) => spec.name === "app"))
    throw new Error("--tunnel needs Signal, the account API and the app: use the app or all target.");

  const tunnels: ChildProcess[] = [];
  const close = closeTunnels(tunnels);
  process.once("exit", close);
  try {
    const [signalUrl, apiUrl] = await Promise.all([openTunnel(signalPort, tunnels), openTunnel(apiPort, tunnels)]);
    const signal = signalTunnelUrl(signalUrl);
    const tunnelled = {
      REMOTE_SIGNAL_URL: signal,
      OPENBOT_REMOTE_SIGNAL_URL: signal,
      OPENBOT_MOBILE_AUTH_API_URL: apiUrl,
    };
    for (const spec of specs) Object.assign(spec.env, tunnelled);
    logger.info(`Mobile Connect API: ${apiUrl}. Signal: ${tunnelled.REMOTE_SIGNAL_URL}.`);
    return close;
  } catch (error) {
    close();
    throw error;
  }
}

export function closeTunnels(tunnels: ChildProcess[]): () => void {
  return () => {
    for (const tunnel of tunnels) if (tunnel.exitCode === null) tunnel.kill("SIGTERM");
  };
}

export function openTunnel(port: string, tunnels: ChildProcess[]): Promise<string> {
  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: developmentChildEnvironment(process.env, "app"),
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
