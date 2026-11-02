// Lists and creates Grok Bot agents against a loopback gateway. No live account is used.
// bun scripts/grok-bot-gateway-e2e.ts
// Writes .openbot-build/grok-bot-gateway-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { GrokBotAccountStore } from "../src/backend/grok-bot/grok-bot-account";
import { createGrokBotAgent, listGrokBotAgents } from "../src/backend/grok-bot/grok-bot-gateway";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-bot-gateway-e2e");
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};

const report = {
  passed: false,
  listed: 0,
  created: false,
  rejectedBlank: false,
  sandboxCalls: 0,
  ensureSandBox: 0,
};

const paths: string[] = [];

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
    paths.push(request.url ?? "");
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

const root = await mkdtemp(join(tmpdir(), "openbot-grok-bot-gateway-"));
const authFile = join(root, "grok-account.json");

try {
  const gateway = await listen(async (request, response) => {
    const body = await readBody(request);
    if (request.url === "/api/listAgents") {
      assert.equal(request.headers.authorization, "Bearer gw-e2e");
      assert.equal(request.headers["x-anyrun-network-token"], "net-e2e");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          agents: [
            { id: "a1", name: "Research", isGroup: false },
            { name: "skip" },
            { agentId: "g1", title: "Desk", memberIds: ["a1"], hiddenFromSidebar: true },
          ],
        }),
      );
      return;
    }
    if (request.url === "/api/createAgent") {
      const parsed = JSON.parse(body);
      assert.equal(isDynamicRecord(parsed) && parsed.origin, "user");
      assert.equal(isDynamicRecord(parsed) && parsed.avatarShape, "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agent: { id: "a2", name: "Notes", description: "Short" } }));
      return;
    }
    response.writeHead(404).end();
  });
  try {
    const store = new GrokBotAccountStore(authFile, cipher);
    await Effect.runPromise(
      store.save({
        accessToken: "grok-access-e2e",
        refreshToken: "grok-refresh-e2e",
        gateway: { url: gateway.url, token: "gw-e2e", headers: { "x-anyrun-network-token": "net-e2e" } },
      }),
    );
    const options = { allowLoopback: true };
    const listed = await Effect.runPromise(listGrokBotAgents(store, options));
    report.listed = listed.length;
    assert.equal(listed.length, 2);
    assert.deepEqual(listed[0], {
      id: "a1",
      name: "Research",
      title: "",
      description: "",
      hidden: false,
      room: false,
    });
    assert.deepEqual(listed[1], {
      id: "g1",
      name: "",
      title: "Desk",
      description: "",
      hidden: true,
      room: true,
    });
    const saved = await Effect.runPromise(store.load());
    assert.equal(saved?.gateway?.url, gateway.url);
    assert.equal(saved?.gateway?.token, "gw-e2e");
    const created = await Effect.runPromise(
      createGrokBotAgent(store, { name: " Notes ", description: "Short" }, options),
    );
    report.created =
      created.id === "a2" &&
      created.name === "Notes" &&
      created.description === "Short" &&
      created.title === "" &&
      created.hidden === false &&
      created.room === false;
    assert.equal(report.created, true);
    const blank = await Effect.runPromise(
      Effect.result(createGrokBotAgent(store, { name: "  ", description: "" }, options)),
    );
    report.rejectedBlank = Result.isFailure(blank);
    assert.equal(report.rejectedBlank, true);
    await Effect.runPromise(listGrokBotAgents(store, options));
    report.sandboxCalls = paths.filter((path) => path.includes("GrokBotService/EnsureSandBox")).length;
    report.ensureSandBox = report.sandboxCalls;
    assert.equal(report.ensureSandBox, 0);
    assert.equal(
      paths.some((path) => path.includes("GrokBotService/EnsureSandBox")),
      false,
    );
    assert.equal(
      paths.some((path) => path.includes("createAgentFromTemplate")),
      false,
    );
    report.passed = true;
  } finally {
    await gateway.close();
  }
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.passed) process.exit(1);
