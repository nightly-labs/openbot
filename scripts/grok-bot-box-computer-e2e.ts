// Box computer control for the Grok Bot sand desktop. No live account and no real driver.
// bun scripts/grok-bot-box-computer-e2e.ts
// Writes .openbot-build/grok-bot-box-computer-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { GrokBotAccountStore } from "../src/backend/grok-bot/grok-bot-account";
import {
  type GrokBotBoxCommandResult,
  GrokBotBoxComputer,
  type GrokBotBoxComputerAction,
} from "../src/backend/grok-bot/grok-bot-box-computer";
import {
  authorizationMatches,
  BOX_EXEC_DAEMON_AUTH_TOKEN_ENV,
  startGrokBotBoxExec,
} from "../src/backend/grok-bot/grok-bot-box-exec";
import {
  captureGrokBotComputerScreenshot,
  ensureGrokBotComputerReady,
  executeGrokBotComputerAction,
} from "../src/backend/grok-bot/grok-bot-gateway";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-bot-box-computer-e2e");
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};

const report: {
  passed: boolean;
  driverTools: string[];
  serialized: boolean;
  driverError: boolean;
  execAuthorized: boolean;
  execRefusedOpenHost: boolean;
  generatedTokenWorks: boolean;
  literalTokenRefused: boolean;
  computerUseSupported: boolean;
  readyPhase: string;
  routedAction: boolean;
  routedScreenshot: boolean;
} = {
  passed: false,
  driverTools: [],
  serialized: false,
  driverError: false,
  execAuthorized: false,
  execRefusedOpenHost: false,
  generatedTokenWorks: false,
  literalTokenRefused: false,
  computerUseSupported: false,
  readyPhase: "",
  routedAction: false,
  routedScreenshot: false,
};

const action = (
  caseName: string,
  value: GrokBotBoxComputerAction["action"]["value"] = {},
): GrokBotBoxComputerAction => ({
  action: { case: caseName, value },
});

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((ready, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => ready(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((ready, reject) => server.close((error) => (error ? reject(error) : ready()))),
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-grok-bot-box-"));
const executable = join(root, "cua-driver");
await writeFile(executable, "test-only");

try {
  const calls: { command: string; args: string[]; display: string | undefined }[] = [];
  let active = 0;
  let maxActive = 0;
  const runner = async (
    command: string,
    args: readonly string[],
    options?: { readonly env?: NodeJS.ProcessEnv },
  ): Promise<GrokBotBoxCommandResult> => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push({ command, args: [...args], display: options?.env?.DISPLAY });
    const tool = args[1];
    if (tool === "get_cursor_position") {
      active -= 1;
      return { code: 0, stdout: '{"x":41,"y":52}', stderr: "" };
    }
    if (tool === "get_desktop_state") {
      const outputIndex = args.indexOf("--screenshot-out-file");
      await writeFile(args[outputIndex + 1] ?? "", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
    await new Promise((ready) => setTimeout(ready, 15));
    active -= 1;
    if (tool === "type_text" && args[2]?.includes("fail")) return { code: 1, stdout: "", stderr: "driver refused" };
    return { code: 0, stdout: "{}", stderr: "" };
  };
  const computer = new GrokBotBoxComputer({
    executable,
    socket: "/tmp/test-cua.sock",
    session: "botai-box",
    environment: {},
    runner,
    temporaryDirectory: root,
  });
  assert.equal(computer.configured, true);
  const result = await Effect.runPromise(
    computer.execute({
      actions: [
        action("mouseMove", { coordinate: { x: 10, y: 20 } }),
        action("click", { coordinate: { x: 11, y: 21 }, button: 2, count: 2 }),
        action("drag", {
          path: [
            { x: 1, y: 2 },
            { x: 8, y: 9 },
          ],
          button: 1,
        }),
        action("scroll", { direction: 2, amount: 3 }),
        action("type", { text: "hello" }),
        action("key", { key: "CTRL+A" }),
        action("cursorPosition"),
        action("screenshot"),
      ],
    }),
  );
  assert.equal(result.result.case, "success");
  if (result.result.case === "success") {
    assert.equal(result.result.value.actionCount, 8);
    assert.equal(result.result.value.cursorPosition?.x, 41);
    assert.equal(result.result.value.cursorPosition?.y, 52);
    assert.equal(
      Buffer.from(result.result.value.screenshot ?? "", "base64")
        .subarray(0, 8)
        .toString("hex"),
      "89504e470d0a1a0a",
    );
  }
  const tools = calls.filter((call) => call.command === executable).map((call) => call.args[1] ?? "");
  report.driverTools = tools;
  assert.deepEqual(tools, [
    "move_cursor",
    "click",
    "drag",
    "get_cursor_position",
    "scroll",
    "type_text",
    "hotkey",
    "get_cursor_position",
    "get_desktop_state",
  ]);
  assert.equal(
    calls.some((call) => call.args.join(" ").includes(";")),
    false,
  );
  const click = calls.find((call) => call.args[1] === "click");
  const clickBody = JSON.parse(click?.args[2] ?? "{}");
  assert.ok(isDynamicRecord(clickBody));
  assert.equal(clickBody.button, "right");
  assert.equal(clickBody.session, "botai-box");
  assert.equal(clickBody.scope, "desktop");
  assert.equal(click?.args[0], "call");
  assert.equal(click?.args[3], "--socket");
  assert.equal(click?.args[4], "/tmp/test-cua.sock");

  calls.length = 0;
  await Effect.runPromise(computer.execute({ actions: [action("mouseDown", { button: 1 })] }));
  assert.equal(calls[0]?.command, "xdotool");
  assert.deepEqual(calls[0]?.args, ["mousedown", "1"]);
  assert.equal(calls[0]?.display, ":1");

  const failed = await Effect.runPromise(computer.execute({ actions: [action("type", { text: "fail" })] }));
  report.driverError = failed.result.case === "error" && failed.result.value.actionCount === 0;
  assert.equal(report.driverError, true);
  if (failed.result.case === "error") assert.equal(failed.result.value.error, "driver refused");

  let batchActive = 0;
  let batchMax = 0;
  const batchComputer = new GrokBotBoxComputer({
    executable,
    socket: "/tmp/test-cua.sock",
    environment: {},
    temporaryDirectory: root,
    runner: async () => {
      batchActive += 1;
      batchMax = Math.max(batchMax, batchActive);
      await new Promise((ready) => setTimeout(ready, 20));
      batchActive -= 1;
      return { code: 0, stdout: "{}", stderr: "" };
    },
  });
  await Promise.all([
    Effect.runPromise(batchComputer.execute({ actions: [action("type", { text: "one" })] })),
    Effect.runPromise(batchComputer.execute({ actions: [action("type", { text: "two" })] })),
  ]);
  report.serialized = batchMax === 1;
  assert.equal(report.serialized, true);

  const exec = await Effect.runPromise(
    startGrokBotBoxExec({ computer, host: "127.0.0.1", port: 0, authToken: "box-token-e2e" }),
  );
  try {
    const denied = await fetch(`${exec.url}/capabilities`, { method: "POST" });
    assert.equal(denied.status, 401);
    const capabilities = await fetch(`${exec.url}/capabilities`, {
      method: "POST",
      headers: { authorization: "Bearer box-token-e2e" },
    });
    assert.equal(capabilities.status, 200);
    const capabilityBody = await capabilities.json();
    report.computerUseSupported = isDynamicRecord(capabilityBody) && capabilityBody.computerUseSupported === true;
    assert.equal(report.computerUseSupported, true);
    const acted = await fetch(`${exec.url}/computer`, {
      method: "POST",
      headers: { authorization: "Bearer box-token-e2e", "content-type": "application/json" },
      body: JSON.stringify({ actions: [action("type", { text: "from-daemon" })] }),
    });
    assert.equal(acted.status, 200);
    const actedBody = await acted.json();
    assert.equal(isDynamicRecord(actedBody) && isDynamicRecord(actedBody.result) && actedBody.result.case, "success");
    report.execAuthorized = true;
  } finally {
    await Effect.runPromise(exec.stop());
  }

  const openHost = await Effect.runPromise(
    Effect.result(
      startGrokBotBoxExec({
        computer,
        host: "0.0.0.0",
        port: 0,
        authToken: "explicit-secret-still-refused",
        environment: {},
      }),
    ),
  );
  report.execRefusedOpenHost = Result.isFailure(openHost);
  assert.equal(report.execRefusedOpenHost, true);
  const literal = await Effect.runPromise(
    Effect.result(startGrokBotBoxExec({ computer, host: "127.0.0.1", port: 0, authToken: "local", environment: {} })),
  );
  const literalEnv = await Effect.runPromise(
    Effect.result(
      startGrokBotBoxExec({
        computer,
        host: "127.0.0.1",
        port: 0,
        environment: { [BOX_EXEC_DAEMON_AUTH_TOKEN_ENV]: "local" },
      }),
    ),
  );
  report.literalTokenRefused = Result.isFailure(literal) && Result.isFailure(literalEnv);
  assert.equal(report.literalTokenRefused, true);
  assert.equal(authorizationMatches("Bearer short", "box-token-e2e"), false);
  assert.equal(authorizationMatches("Bearer box-token-e2e", "box-token-e2e"), true);

  const generated = await Effect.runPromise(
    startGrokBotBoxExec({ computer, host: "127.0.0.1", port: 0, environment: {} }),
  );
  try {
    assert.notEqual(generated.authToken, "local");
    assert.ok(generated.authToken.length >= 32);
    const knownWord = await fetch(`${generated.url}/capabilities`, {
      method: "POST",
      headers: { authorization: "Bearer local" },
    });
    assert.equal(knownWord.status, 401);
    const accepted = await fetch(`${generated.url}/capabilities`, {
      method: "POST",
      headers: { authorization: `Bearer ${generated.authToken}` },
    });
    assert.equal(accepted.status, 200);
    report.generatedTokenWorks = true;
  } finally {
    await Effect.runPromise(generated.stop());
  }

  let mode: "wake" | "off" | "action" = "wake";
  const seen: string[] = [];
  const gateway = await listen(async (request, response) => {
    const body = await readBody(request);
    seen.push(request.url ?? "");
    assert.equal(request.headers.authorization, "Bearer gw-e2e");
    if (request.url === "/api/ensureForeverBox") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(mode === "off" ? { state: "absent" } : { state: "starting" }));
      return;
    }
    if (request.url === "/api/getForeverBoxStatus") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          state: "running",
          vncUrl: "http://127.0.0.1:6080/vnc.html?network_token=tok",
        }),
      );
      return;
    }
    if (request.url === "/api/executeRoutedComputerAction") {
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && parsed.agentId, "agent-1");
      assert.equal(isDynamicRecord(parsed) && parsed.toolCallId, "call-1");
      const args = isDynamicRecord(parsed) ? parsed.args : null;
      assert.equal(isDynamicRecord(args) && args.action, "click");
      assert.equal(isDynamicRecord(args) && args.x, 12);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ content: "Computer action completed on your BotAI computer." }));
      return;
    }
    if (request.url === "/api/captureRoutedComputerScreenshot") {
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && parsed.agentId, "agent-1");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ botaiImage: { data: "abc", mimeType: "image/png" } }));
      return;
    }
    response.writeHead(404).end();
  });
  try {
    const store = new GrokBotAccountStore(join(root, "grok-account.json"), cipher);
    await Effect.runPromise(
      store.save({
        accessToken: "grok-access-e2e",
        refreshToken: "grok-refresh-e2e",
        gateway: { url: gateway.url, token: "gw-e2e", headers: {} },
      }),
    );
    const options = { allowLoopback: true, readyAttempts: 3, readyDelayMs: 0 };
    const ready = await Effect.runPromise(ensureGrokBotComputerReady(store, options));
    report.readyPhase = ready.phase;
    assert.equal(ready.phase, "running");
    assert.equal(ready.vncUrl, "http://127.0.0.1:6080/vnc.html?network_token=tok");
    assert.deepEqual(seen.slice(0, 2), ["/api/ensureForeverBox", "/api/getForeverBoxStatus"]);

    mode = "off";
    seen.length = 0;
    const idle = await Effect.runPromise(ensureGrokBotComputerReady(store, options));
    assert.equal(idle.phase, "off");
    assert.deepEqual(seen, ["/api/ensureForeverBox"]);

    mode = "action";
    const acted = await Effect.runPromise(
      executeGrokBotComputerAction(
        store,
        { agentId: "agent-1", toolCallId: "call-1", args: { action: "click", x: 12, y: 40, button: "left" } },
        options,
      ),
    );
    report.routedAction =
      isDynamicRecord(acted) && acted.content === "Computer action completed on your BotAI computer.";
    assert.equal(report.routedAction, true);
    const shot = await Effect.runPromise(captureGrokBotComputerScreenshot(store, "agent-1", options));
    const image = isDynamicRecord(shot) && isDynamicRecord(shot.botaiImage) ? shot.botaiImage : null;
    report.routedScreenshot = image?.data === "abc" && image.mimeType === "image/png";
    assert.equal(report.routedScreenshot, true);
  } finally {
    await gateway.close();
  }

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) process.exit(1);
