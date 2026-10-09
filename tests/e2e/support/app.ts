import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { _electron, type ElectronApplication, expect, type Page } from "@playwright/test";
import { z } from "zod";
import { removeDevStackRecord, writeDevStackRecord } from "../../../scripts/dev-automation/stack-registry";
import { withoutElectronRuntimeFlags } from "../../../scripts/electron-spawn-env";
import { root, settings } from "./settings";

const logger = createOpenBotLogger("e2e-app");
const execute = promisify(execFile);

export class TestApp {
  application: ElectronApplication;
  page: Page;
  readonly profile: string;
  readonly live: boolean;
  readonly email: string;
  private stopped = false;

  private constructor(application: ElectronApplication, page: Page, profile: string, live: boolean, email: string) {
    this.application = application;
    this.page = page;
    this.profile = profile;
    this.live = live;
    this.email = email;
  }

  static async start(profile: string, live: boolean, email: string) {
    await execute("bun", ["tests/e2e/support/seed.ts", profile, live ? "live" : "scripted"], { cwd: root });
    const { application, page } = await TestApp.launch(profile, live);
    const instance = new TestApp(application, page, profile, live, email);
    try {
      await instance.signIn();
      if (live && process.env.OPENCODE_API_KEY) {
        await page.evaluate(
          (key) => window.openbot.setProviderApiKey({ provider: "opencode", key }),
          process.env.OPENCODE_API_KEY,
        );
      }
      return instance;
    } catch (error) {
      await instance.stop();
      throw error;
    }
  }

  private static async launch(profile: string, live: boolean) {
    if (!(await readFile(join(root, "out/main/index.js"), "utf8")).includes("OPENBOT_DEV_ISOLATED_WORKSPACES")) {
      throw new Error("The app build is stale. Build this commit in CI before E2E.");
    }
    const protocol = join(profile, "protocol");
    await mkdir(protocol, { recursive: true });
    const executable = join(root, "tests/e2e/support/scripted-provider.ts");
    await chmod(executable, 0o755);
    const env = withoutElectronRuntimeFlags({
      ...process.env,
      OPENBOT_APP_VARIANT: "preview",
      OPENBOT_AUTH_API_URL: settings().apiUrl,
      OPENBOT_DEV_REGISTRY_DIR: settings().registry,
      OPENBOT_DEV_ISOLATED_WORKSPACES: "1",
      OPENBOT_DEV_REMOTE_ROLE: "none",
      OPENBOT_DEV_TEST_CLIENT_ENABLED: "0",
      OPENBOT_E2E_PROTOCOL_STATE: protocol,
      ...(!live
        ? {
            OPENBOT_CODEX_PATH: executable,
            OPENBOT_CLAUDE_PATH: join(profile, "unavailable-claude"),
            OPENBOT_OPENCODE_PATH: join(profile, "unavailable-opencode"),
            OPENBOT_GROK_PATH: join(profile, "unavailable-grok"),
          }
        : {}),
    });
    // Never inherit a development renderer URL or another instance's debug port.
    delete env.ELECTRON_RENDERER_URL;
    delete env.OPENBOT_DEV_REMOTE_DEBUGGING_PORT;
    const application = await _electron.launch({
      args: [root, `--user-data-dir=${profile}`, ...(process.platform === "linux" ? ["--password-store=basic"] : [])],
      cwd: root,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      chromiumSandbox: true,
      timeout: 60_000,
    });
    const child = application.process();
    for (const stream of [child.stdout, child.stderr]) {
      if (stream) createInterface({ input: stream }).on("line", (line) => logger.info(line));
    }
    if (!child.pid) throw new Error("Electron has no PID.");
    writeDevStackRecord({
      services: ["app"],
      projectRoot: root,
      supervisorPid: child.pid,
      startedAt: Date.now(),
      ports: [],
      processes: [{ name: "app", pid: child.pid, startedAt: Date.now() }],
    });
    try {
      await expect
        .poll(() => application.windows().some((window) => window.url() === "openbot-app://app/index.html"), {
          timeout: 60_000,
        })
        .toBe(true);
      const page = application.windows().find((window) => window.url() === "openbot-app://app/index.html");
      if (!page) throw new Error("The main application window did not open.");
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") logger.warn(message.text());
      });
      page.on("pageerror", (error) => logger.warn(error.message));
      await page.waitForFunction(() => typeof window.openbot?.agent === "object");
      return { application, page };
    } catch (error) {
      await application.close();
      removeDevStackRecord({ supervisorPid: child.pid });
      throw error;
    }
  }

  private async signIn() {
    await expect
      .poll(() => this.page.evaluate(() => window.openbot.auth.getState().then((state) => state.status)), {
        timeout: 60_000,
      })
      .not.toBe("loading");
    const state = await this.page.evaluate(() => window.openbot.auth.getState());
    if (state.status !== "signed_in") {
      const challenge = await this.page.evaluate((email) => window.openbot.auth.requestEmailCode(email), this.email);
      if (challenge.status !== "code_sent" || !challenge.developmentCode)
        throw new Error("E2E requires development email codes.");
      const signedIn = await this.page.evaluate((input) => window.openbot.auth.verifyEmailCode(input), {
        challengeId: challenge.challengeId,
        code: challenge.developmentCode,
      });
      expect(signedIn.status).toBe("signed_in");
    }
    await this.page.evaluate(() => window.openbot.auth.updateName("Release test"));
    const host = await this.page.evaluate(() => window.openbot.host.getStatus());
    if (!host.configured)
      await this.page.evaluate(
        (serverName) => window.openbot.host.configure({ serverName }),
        `Release ${basename(this.profile)}`,
      );
    await expect
      .poll(() => this.page.evaluate(() => window.openbot.agent.listAgents().then((agents) => agents.length)), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
  }

  // Fixture setup uses the real account API. Keep the session token inside Electron, before tracing.
  async accountRequest(path: string, body: Record<string, string>) {
    const encrypted = await readFile(join(this.profile, "openbot-central-auth-v1.bin"), "utf8");
    return this.application.evaluate(
      async ({ safeStorage }, input) => {
        const stored = JSON.parse(safeStorage.decryptString(Buffer.from(input.encrypted, "base64")));
        const response = await fetch(`${input.apiUrl}${input.path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${stored.sessionToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(input.body),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`E2E account setup failed with HTTP ${response.status}.`);
        return response.json();
      },
      { encrypted, apiUrl: settings().apiUrl, path, body },
    );
  }

  async restart() {
    await this.stop();
    const next = await TestApp.launch(this.profile, this.live);
    this.application = next.application;
    this.page = next.page;
    this.stopped = false;
    await this.signIn();
  }

  async stop() {
    if (this.stopped) return;
    const pid = this.application.process().pid;
    await this.application.close();
    this.stopped = true;
    if (pid) removeDevStackRecord({ supervisorPid: pid });
  }

  async downloadTo(path: string) {
    await this.application.evaluate(({ dialog }, selected) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: selected });
    }, path);
  }

  async release(key: string) {
    await writeFile(join(this.profile, "protocol", key), "release");
  }
}

export async function joinHost(host: TestApp, client: TestApp): Promise<string> {
  const configured = await host.page.evaluate(() => window.openbot.host.getStatus());
  if (!configured.configured)
    await host.page.evaluate(() => window.openbot.host.configure({ serverName: "Release host" }));
  await host.page.evaluate(() => window.openbot.host.start());
  await expect
    .poll(() => host.page.evaluate(() => window.openbot.host.getStatus().then((value) => value.apiOnline)), {
      timeout: 60_000,
    })
    .toBe(true);
  const status = await host.page.evaluate(() => window.openbot.host.getStatus());
  if (!status.serverId) throw new Error("The test host has no identity.");
  // Local HTTP account URLs are deliberately not valid production invitation links. Create and
  // accept this setup invitation through the account API, then discover the host through Signal.
  const invite = z
    .object({ token: z.string() })
    .parse(
      await host.accountRequest(`/v2/remote/hosts/${encodeURIComponent(status.serverId)}/invites`, { role: "admin" }),
    );
  registerSecretValue(invite.token);
  const accepted = z
    .object({ hostId: z.string() })
    .parse(await client.accountRequest("/v2/remote/invites/accept", { token: invite.token }));
  expect(accepted.hostId).toBe(status.serverId);
  // The setup request bypasses the client's join handler. Reload its account directory on startup.
  await client.restart();
  await expect
    .poll(
      () =>
        client.page
          .evaluate(() => window.openbot.servers.list())
          .then((servers) => servers.some((server) => server.id === accepted.hostId)),
      { timeout: 60_000 },
    )
    .toBe(true);
  await client.page.evaluate((id) => window.openbot.servers.select(id), accepted.hostId);
  await assertHost(client, accepted.hostId);
  logger.info("Client connected to the test host through WebRTC.");
  return accepted.hostId;
}

export async function assertHost(client: TestApp, id: string) {
  await expect
    .poll(
      () =>
        client.page.evaluate(
          (serverId) =>
            window.openbot.servers.list().then((servers) => {
              const server = servers.find((entry) => entry.id === serverId);
              return { state: server?.state, active: server?.active };
            }),
          id,
        ),
      { timeout: 60_000 },
    )
    .toEqual({ state: "online", active: true });
  const stored = z
    .object({ servers: z.array(z.object({ id: z.string(), transport: z.string().optional() })) })
    .parse(JSON.parse(await readFile(join(client.profile, "openbot-remote-servers-v1.json"), "utf8")));
  expect(stored.servers.find((server) => server.id === id)?.transport).toBe("webrtc-v2");
}

export function testEmail() {
  return `release-${randomUUID()}@example.com`;
}
