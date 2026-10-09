import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { createOpenBotLogger } from "@openbot/logging";
import { expect } from "@playwright/test";
import { readAllDevStackRecords } from "../../scripts/dev-automation/stack-registry";
import { withoutElectronRuntimeFlags } from "../../scripts/electron-spawn-env";

const root = resolve(import.meta.dirname, "../..");
const logger = createOpenBotLogger("visual-storybook");

export default async function setup() {
  const running = () =>
    readAllDevStackRecords().find((record) => record.projectRoot === root && record.services.includes("storybook"));
  const existing = running();
  const child = existing
    ? null
    : spawn("bun", ["run", "storybook", "--no-open", "--quiet"], {
        cwd: root,
        env: withoutElectronRuntimeFlags(process.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
  if (child)
    for (const stream of [child.stdout, child.stderr]) {
      if (stream) createInterface({ input: stream }).on("line", (line) => logger.info(line));
    }
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "exit");
      child.kill("SIGTERM");
      await closed;
    }
  };
  try {
    await expect
      .poll(
        async () => {
          if (child && (child.exitCode !== null || child.signalCode !== null))
            throw new Error("Storybook stopped before it became ready.");
          const port = running()?.ports.find((entry) => entry.name === "storybook")?.port;
          if (!port) return false;
          const url = `http://127.0.0.1:${port}`;
          const ready = await fetch(`${url}/index.json`)
            .then((response) => response.ok)
            .catch(() => false);
          if (ready) process.env.OPENBOT_VISUAL_BASE_URL = url;
          return ready;
        },
        { timeout: 120_000, message: "This worktree's Storybook must become ready." },
      )
      .toBe(true);
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}
