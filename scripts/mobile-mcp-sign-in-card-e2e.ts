// Checks the MCP sign-in card of the mobile chat (#2991) on the iOS development build. A saved http
// MCP server that waits for a sign-in shows as a card in the agent chat, as on desktop. Sign in starts
// the relayed sign-in on the host, Continue sends the agent the message that tells it to test again,
// and the card then says that the user signed in.
//
// 1. `bun scripts/mobile-mcp-sign-in-card-e2e.ts --seed` while this worktree's dev app is stopped:
//    it saves the MCP server and puts the sign-in request in the chat of the seed agent `chief`.
// 2. `bun run dev:mobile`, so that the app runs on a booted simulator.
// 3. `bun scripts/mobile-mcp-sign-in-card-e2e.ts --allow-mutations [--pair]`. It starts a local OAuth
//    MCP server, opens the chat by link, and presses the card's buttons through the React DevTools
//    hook of the development build. Links go to the app through Metro's debugger, because iOS asks
//    before it opens a `simctl openurl` link; `--pair` pairs the app the same way first. The desktop
//    sign-in opens one page in the default browser of this computer, which the local server sends
//    straight back. Continue starts a turn of `chief`.
//
// It writes .openbot-build/mobile-mcp-sign-in-card-e2e/report.json and one screenshot per step, and
// exits non-zero on a failure.
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { type ConversationMessage, type McpServerConfig, mcpSignInItemType } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import WebSocket from "ws";
import { z } from "zod";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpServerStore } from "../src/backend/mcp-server-store";
import { developmentInstanceIdForWorktree, developmentUserDataName } from "../src/main/development-profile";
import { type AutomationSession, connectToDevApp } from "./dev-automation/cdp-client";
import { readDevInstanceRecords, selectDevInstance } from "./dev-automation/instance-registry";
import { bootedSimulatorIds } from "./dev-mobile";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";
import { isDevelopmentProfileActive } from "./seed-dev-state";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-mcp-sign-in-card-e2e");
const SEED_FILE = join(OUT, "seed.json");
const BUNDLE_ID = "run.openbot.mobile";
const AGENT_ID = "chief";
const OTHER_AGENT_ID = "research";
const MCP_NAME = "e2e_sign_in";
const MESSAGE_ID = "e2e-mcp-sign-in-card";
const ACCESS_TOKEN = "e2e-access-token";
const SIGN_IN_LABEL = `Sign in to ${MCP_NAME}`;
const CONTINUE_LABEL = `Tell the agent to test ${MCP_NAME} again`;
const CONTINUE_TEXT = `I signed in to the MCP server ${MCP_NAME}. Test it again.`;
const STEP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

const logger = createOpenBotLogger("mobile-mcp-sign-in-card-e2e");
const cdpLogger = createOpenBotLogger("mobile-mcp-sign-in-card-e2e", undefined, "warn");
const run = promisify(execFile);

const seedFile = z.object({ mcpServerId: z.string(), port: z.number() });
type Seed = z.infer<typeof seedFile>;
const registrationRequest = z.object({ redirect_uris: z.array(z.string()) });
const rpcRequest = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() });
const metroTargets = z.array(z.object({ appId: z.string().optional(), webSocketDebuggerUrl: z.string().optional() }));
const evaluateReply = z.object({
  id: z.number().optional(),
  result: z
    .object({
      result: z.object({ value: z.unknown() }).optional(),
      exceptionDetails: z.unknown().optional(),
    })
    .optional(),
});
const signInResult = z.object({ error: z.unknown().optional() });
const signInStates = z.array(z.object({ mcpServerId: z.string(), signedIn: z.boolean() }));
const connectedDevices = z.array(z.object({ platform: z.string(), connectedAt: z.number() }));

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  screenshot?: string;
}

const steps: Step[] = [];

/** The link of an agent's chat. The app opens the chat on the host that it shows; it does not read `server`. */
function chatLink(agentId: string): string {
  return `openbot://live-activity?server=e2e&agent=${agentId}`;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || null;
}

async function waitFor<T>(label: string, probe: () => Promise<T | null>, timeoutMs = STEP_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError}` : ""}`);
}

function profilePath(): string {
  return join(resolveDevelopmentAppDataRoot(), developmentUserDataName("app", developmentInstanceIdForWorktree(ROOT)));
}

function mcpConfig(id: string, port: number): McpServerConfig {
  return {
    id,
    name: MCP_NAME,
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: [],
  };
}

/** Saves the http server and puts its sign-in request at the end of the chat, as the agent tool does. */
async function seed(): Promise<void> {
  const profile = profilePath();
  if (await isDevelopmentProfileActive(profile)) {
    throw new Error("Stop this worktree's dev app (`bun run dev:stop`) before you seed.");
  }
  const port = Number(option("port") ?? 28471);
  const agentStore = new AgentStore(profile, homedir());
  try {
    await runCauseEffect(agentStore.initialize());
    const agent = agentStore.list().find((candidate) => candidate.id === AGENT_ID);
    if (!agent?.threadId) throw new Error(`The profile has no agent ${AGENT_ID}. Run \`bun run dev:seed\` first.`);
    const servers = new McpServerStore(agentStore.database);
    const existing = servers.list().find((config) => config.name === MCP_NAME);
    const saved = servers.save(mcpConfig(existing?.id ?? "", port));
    const snapshot = agentStore.database.readConversation(AGENT_ID, agent.threadId);
    const request: ConversationMessage = {
      id: MESSAGE_ID,
      author: "system",
      source: "system",
      text: sourceText("status.agent.mcpSignInRequested", { name: saved.name }),
      createdAt: new Date().toISOString(),
      status: "completed",
      itemType: mcpSignInItemType({ mcpServerId: saved.id }),
    };
    agentStore.database.persistConversation(
      { ...snapshot, messages: [...snapshot.messages.filter((message) => message.id !== MESSAGE_ID), request] },
      "e2e.mcp_sign_in_card",
      {},
      `e2e:mobile-mcp-sign-in-card:${Date.now()}`,
    );
    mkdirSync(OUT, { recursive: true });
    writeFileSync(SEED_FILE, `${JSON.stringify({ mcpServerId: saved.id, port } satisfies Seed, null, 2)}\n`);
    logger.info(`Seeded MCP server ${saved.id} and the sign-in request in ${profile}.`);
  } finally {
    agentStore.database.close();
  }
}

function readSeed(): Seed {
  return seedFile.parse(JSON.parse(readFileSync(SEED_FILE, "utf8")));
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

/** An MCP server behind OAuth with a public client. Its sign-in page sends the browser straight back. */
async function oauthServer(port: number): Promise<{ authorizeRequests: number; close: () => Promise<void> }> {
  const base = `http://127.0.0.1:${port}`;
  const state = { authorizeRequests: 0 };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", base);
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp")
        return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server")
        return json(response, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      if (request.method === "POST" && url.pathname === "/register") {
        const asked = registrationRequest.parse(JSON.parse(await body(request)));
        return json(response, 201, {
          client_id: "e2e-client",
          token_endpoint_auth_method: "none",
          redirect_uris: asked.redirect_uris,
        });
      }
      if (request.method === "GET" && url.pathname === "/authorize") {
        state.authorizeRequests += 1;
        const back = new URL(url.searchParams.get("redirect_uri") ?? "");
        back.searchParams.set("code", "e2e-grant");
        const returned = url.searchParams.get("state");
        if (returned) back.searchParams.set("state", returned);
        response.writeHead(302, { location: back.toString() }).end();
        return;
      }
      if (request.method === "POST" && url.pathname === "/token") {
        const form = new URLSearchParams(await body(request));
        if (form.get("grant_type") === "authorization_code" && form.get("code") !== "e2e-grant")
          return json(response, 400, { error: "invalid_grant" });
        return json(response, 200, { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600 });
      }
      if (url.pathname !== "/mcp") return json(response, 404, { error: "not found" });
      if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`)
        return json(
          response,
          401,
          { error: "unauthorized" },
          { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` },
        );
      const { id, method } = rpcRequest.parse(JSON.parse(await body(request)));
      if (id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (method === "initialize")
        return json(response, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: MCP_NAME, version: "1" },
          },
        });
      if (method === "tools/list")
        return json(response, 200, {
          jsonrpc: "2.0",
          id,
          result: { tools: [{ name: "ping", description: "ping", inputSchema: { type: "object" } }] },
        });
      return json(response, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "unknown" } });
    })().catch((error: unknown) => {
      response.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });
  return {
    get authorizeRequests() {
      return state.authorizeRequests;
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

async function selectSimulator(): Promise<string> {
  const requested = option("simulator");
  if (requested) return requested;
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
  const withApp: string[] = [];
  for (const udid of bootedSimulatorIds(JSON.parse(stdout))) {
    try {
      await run("xcrun", ["simctl", "get_app_container", udid, BUNDLE_ID]);
      withApp.push(udid);
    } catch {
      // OpenBot is not installed on this simulator.
    }
  }
  const [udid, ...extra] = withApp;
  if (!udid) throw new Error("No booted simulator has OpenBot installed. Run `bun run dev:mobile` first.");
  if (extra.length > 0) throw new Error("Several booted simulators have OpenBot. Pass --simulator=<udid>.");
  return udid;
}

/** Runs an expression in the app's JavaScript runtime through the Metro inspector. */
async function evaluateInApp<T>(metroPort: number, expression: string, value: z.ZodType<T>): Promise<T> {
  const targets = metroTargets.parse(await (await fetch(`http://127.0.0.1:${metroPort}/json/list`)).json());
  const target = targets.findLast((candidate) => candidate.appId === BUNDLE_ID && candidate.webSocketDebuggerUrl);
  if (!target?.webSocketDebuggerUrl) throw new Error("The app runtime is not in Metro.");
  // Expo closes a debugger socket whose origin is not its own server address.
  const socket = new WebSocket(target.webSocketDebuggerUrl, { headers: { origin: `http://127.0.0.1:${metroPort}` } });
  try {
    await new Promise<void>((done, fail) => {
      socket.once("open", () => done());
      socket.once("error", () => fail(new Error("The app debugger did not connect.")));
    });
    return await new Promise<T>((done, fail) => {
      socket.once("close", () => fail(new Error("The app debugger closed the connection.")));
      socket.on("message", (data) => {
        const reply = evaluateReply.safeParse(JSON.parse(String(data)));
        if (!reply.success || reply.data.id !== 1) return;
        const { result } = reply.data;
        if (result?.exceptionDetails) fail(new Error(JSON.stringify(result.exceptionDetails)));
        else done(value.parse(result?.result?.value));
      });
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    });
  } finally {
    socket.close();
  }
}

// Evaluated in the app, so it is a string: this file is typechecked against Node globals. It walks
// the committed fibers that the development build reports to the React DevTools hook.
const FIBER_HELPERS = `
  const roots = [];
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook && hook.getFiberRoots) for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) roots.push(root);
  const fibers = function* () {
    for (const root of roots) {
      const stack = [root.current];
      while (stack.length) {
        const fiber = stack.pop();
        if (!fiber) continue;
        yield fiber;
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
    }
  };
  const texts = [];
  for (const fiber of fibers()) {
    const props = fiber.memoizedProps;
    if (props && typeof props.children === "string") texts.push(props.children);
    if (props && typeof props.accessibilityLabel === "string") texts.push(props.accessibilityLabel);
  }
`;

async function screenTexts(metroPort: number): Promise<string[]> {
  return evaluateInApp(metroPort, `(() => { ${FIBER_HELPERS} return texts; })()`, z.array(z.string()));
}

/** Presses the control with this accessibility label. False when the screen has none. */
async function press(metroPort: number, label: string): Promise<boolean> {
  return evaluateInApp(
    metroPort,
    `(() => { ${FIBER_HELPERS}
      for (const fiber of fibers()) {
        const props = fiber.memoizedProps;
        if (props && props.accessibilityLabel === ${JSON.stringify(label)} && typeof props.onPress === "function") {
          props.onPress({ nativeEvent: {} });
          return true;
        }
      }
      return false;
    })()`,
    z.boolean(),
  );
}

/**
 * Gives the app a link as iOS does. `simctl openurl` asks "Open in OpenBot?" first, and a script
 * cannot answer that prompt.
 */
async function openInApp(metroPort: number, url: string): Promise<void> {
  const opened = await evaluateInApp(
    metroPort,
    `(() => {
      for (const [id, module] of __r.getModules()) {
        if (!String(module.verboseName).endsWith("Libraries/EventEmitter/RCTDeviceEventEmitter.js")) continue;
        __r(id).default.emit("url", { url: ${JSON.stringify(url)} });
        return true;
      }
      return false;
    })()`,
    z.boolean(),
  );
  if (!opened) throw new Error("The app has no React Native event emitter.");
}

async function pair(metroPort: number, session: AutomationSession): Promise<void> {
  const sentAt = Date.now() - 1_000;
  const link = z
    .string()
    .parse(await session.page.evaluate("window.openbot.auth.createMobileConnect().then((ticket) => ticket.qrData)"));
  await openInApp(metroPort, link);
  await waitFor("the simulator to redeem the ticket", async () => {
    const devices = connectedDevices.parse(
      await session.page.evaluate("window.openbot.auth.listMobileConnectedDevices()"),
    );
    return devices.some((device) => device.platform === "ios" && device.connectedAt >= sentAt) ? true : null;
  });
  logger.info("Paired the simulator with this worktree's desktop.");
}

/** Opens the chat after another one. A new visit reads the sign-ins of the host again. */
async function revisitChat(metroPort: number): Promise<void> {
  await openInApp(metroPort, chatLink(OTHER_AGENT_ID));
  await waitFor("the other chat", async () => ((await screenTexts(metroPort)).includes(MCP_NAME) ? null : true));
  await openInApp(metroPort, chatLink(AGENT_ID));
}

/** How many Continue messages the host has in the chat. */
async function continueMessages(session: AutomationSession): Promise<number> {
  return z
    .number()
    .parse(
      await session.page.evaluate(
        `window.openbot.agent.readConversation(${JSON.stringify(AGENT_ID)}, "local").then((snapshot) => snapshot.messages.filter((message) => message.author === "user" && message.text === ${JSON.stringify(CONTINUE_TEXT)}).length)`,
      ),
    );
}

async function screenshot(udid: string, name: string): Promise<string> {
  const path = join(OUT, `${name}.png`);
  await run("xcrun", ["simctl", "io", udid, "screenshot", path]);
  return path;
}

async function main(): Promise<void> {
  if (process.argv.includes("--seed")) return seed();
  if (!process.argv.includes("--allow-mutations")) {
    throw new Error("This test signs in on the host and sends a message to an agent. Pass --allow-mutations.");
  }
  const metroPort = Number(option("metro-port") ?? 8081);
  const { mcpServerId, port } = readSeed();
  const selection = selectDevInstance(readDevInstanceRecords(), { projectRoot: ROOT, service: "app" });
  if (selection.kind !== "selected" || selection.match !== "worktree") {
    throw new Error("This worktree's dev app does not run. Start it with `bun run dev:mobile`.");
  }
  const desktop = selection.record;
  const session = await connectToDevApp(desktop.remoteDebuggingPort, cdpLogger, {
    expectedRendererPort: desktop.rendererPort,
    ownerPid: desktop.pid,
  });
  const udid = await selectSimulator();
  const server = await oauthServer(port);
  mkdirSync(OUT, { recursive: true });
  const step = async (name: string, check: () => Promise<{ passed: boolean; detail?: unknown }>) => {
    let result: { passed: boolean; detail?: unknown };
    try {
      result = await check();
    } catch (error) {
      result = { passed: false, detail: error instanceof Error ? error.message : String(error) };
    }
    steps.push({ name, ...result, screenshot: await screenshot(udid, name) });
    logger.info(`${result.passed ? "PASS" : "FAIL"} ${name}`);
    return result.passed;
  };
  try {
    if (process.argv.includes("--pair")) await pair(metroPort, session);
    // The host keeps a grant for each server address, so the sign-in of an earlier run still counts.
    const signedOut = signInStates.parse(
      await session.page.evaluate(
        `window.openbot.agent.signOutMcpServer({ mcpServerId: ${JSON.stringify(mcpServerId)} }, "local")`,
      ),
    );
    if (signedOut.some((state) => state.mcpServerId === mcpServerId && state.signedIn)) {
      throw new Error("The host did not sign out of the test server.");
    }
    await revisitChat(metroPort);
    await step("card-shows-sign-in", async () => {
      const address = mcpConfig(mcpServerId, port).url;
      const texts = await waitFor("the sign-in card", async () => {
        const shown = await screenTexts(metroPort);
        return shown.includes(SIGN_IN_LABEL) ? shown : null;
      });
      return {
        passed: texts.includes(MCP_NAME) && texts.includes(address),
        detail: { name: MCP_NAME, address, button: SIGN_IN_LABEL },
      };
    });

    // The host starts the relayed sign-in and answers the page of the local server. That page is
    // not https, so the phone must refuse to open it and say why.
    await step("sign-in-relays-to-host", async () => {
      if (!(await press(metroPort, SIGN_IN_LABEL))) return { passed: false, detail: "No Sign in button." };
      const refusal = "The server gave a sign-in page that is not a secure web page.";
      await waitFor("the refused sign-in page", async () =>
        (await screenTexts(metroPort)).includes(refusal) ? true : null,
      );
      return { passed: server.authorizeRequests === 0, detail: refusal };
    });

    // The phone refuses a page that is not https, so the sign-in that Continue needs is made on the
    // desktop. Its browser page goes to the local server, which sends it straight back.
    await step("desktop-sign-in", async () => {
      const result = signInResult.parse(
        await session.page.evaluate(
          `window.openbot.agent.signInMcpServer({ config: ${JSON.stringify(mcpConfig(mcpServerId, port))} }, "local")`,
        ),
      );
      return { passed: !result.error, detail: result };
    });

    await revisitChat(metroPort);
    await step("card-shows-continue", async () => {
      await waitFor("the Continue button", async () =>
        (await screenTexts(metroPort)).includes(CONTINUE_LABEL) ? true : null,
      );
      return { passed: true };
    });

    await step("continue-sends-message", async () => {
      const sentBefore = await continueMessages(session);
      if (!(await press(metroPort, CONTINUE_LABEL))) return { passed: false, detail: "No Continue button." };
      await waitFor("the Signed in state", async () =>
        (await screenTexts(metroPort)).includes("Signed in") ? true : null,
      );
      const sentAfter = await waitFor("the message on the host", async () => {
        const count = await continueMessages(session);
        return count > sentBefore ? count : null;
      });
      return { passed: sentAfter === sentBefore + 1, detail: { text: CONTINUE_TEXT, sentBefore, sentAfter } };
    });
  } finally {
    await server.close();
    await session.close();
    const passed = steps.length === 5 && steps.every((item) => item.passed);
    writeFileSync(
      join(OUT, "report.json"),
      `${JSON.stringify({ passed, simulator: udid, mcpServerId, steps }, null, 2)}\n`,
    );
    logger.info(`Wrote ${join(OUT, "report.json")}.`);
    if (!passed) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
