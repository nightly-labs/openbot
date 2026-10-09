import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_SCHEMA_FINGERPRINT, spawnMspConnection } from "@muse-code/sdk";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { MuseAgentClient, type MuseProviderOptions } from "./muse-client";
import {
  type AppServerNotification,
  decodeAccountReadResult,
  decodeRecordResponse,
  decodeThreadResponse,
  decodeTurnResponse,
} from "./protocol";

/* Failure modes: the host loses final items; a gap hides an item; a page crosses sessions;
 * an inherited key reaches the wrong account; MCP refresh leaves an old process alive.
 * These tests use the real SDK over a child-process boundary and a saved session fixture. */
const HOST = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const statePath = process.env.MUSE_TEST_STATE;
const emit = (value) => process.stdout.write(JSON.stringify({jsonrpc:"2.0", ...value}) + "\n");
const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const item = (state) => ({itemId:"answer",kind:"agentMessage",revision:2,status:"completed",turnId:state.turnId,text:"Recovered answer"});
const event = (method, state, extra) => ({method,params:{sessionId:state.sessionId,...extra}});
readline.createInterface({input:process.stdin}).on("line", line => {
 const frame = JSON.parse(line); const p = frame.params || {}; let result = {};
 if (!Object.hasOwn(frame, "id")) return;
 if(frame.method === "initialize") result = {schema:{version:1,fingerprint:process.env.MUSE_TEST_FINGERPRINT},grantedCapabilities:["sessionMcp"],sessionDurability:"durable"};
 if(frame.method === "session/start" || frame.method === "session/resume") {
   const previous = readState();
   const state = {...previous, sessionId:p.sessionId, mcp:p.config.mcpServers, apiKey:process.env.META_API_KEY || null};
   fs.writeFileSync(statePath, JSON.stringify(state));
   result = {session:{sessionId:p.sessionId}};
 }
 if(frame.method === "turn/start") {
   const state = {...readState(),turnId:p.commandId}; fs.writeFileSync(statePath, JSON.stringify(state));
   emit({id:frame.id,result:{turnId:p.commandId}});
   if(process.env.MUSE_TEST_GAP === "1") {
     emit(event("view/gap",state,{after:"a",next:"c"}));
   } else {
     emit(event("item/started",state,{item:{...item(state),revision:1,status:"inProgress",text:"Partial"}}));
   }
   emit(event("turn/completed",state,{turnId:state.turnId,terminal: process.env.MUSE_TEST_ERROR === "1" ? "failed" : "completed", ...(process.env.MUSE_TEST_ERROR === "1" ? {error:{message:"Rejected key: " + process.env.META_API_KEY}} : {}), viewCursor:"c"}));
   return;
 }
 if(frame.method === "session/read") {
   const state = readState(); result={session:{sessionId:state.sessionId},history:{mode:"inline",items:state.turnId ? [item(state)] : [],snapshot:null}};
 }
 if(frame.method === "view/page") {
   const state=readState();
   result={events:[event("item/completed",state,{sessionId:process.env.MUSE_TEST_WRONG_SESSION === "1" ? "wrong" : state.sessionId,item:item(state),viewCursor:"b"}),event("turn/completed",state,{turnId:state.turnId,terminal:"completed",viewCursor:"c"})],nextCursor:null};
 }
 emit({id:frame.id,result});
});
process.stdin.on("end",()=>process.exit(0));
`;

const clients: MuseAgentClient[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await runCauseEffect(client.stop());
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture(options: Partial<MuseProviderOptions> = {}, environment: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openbot-muse-"));
  directories.push(directory);
  const statePath = join(directory, "session.json");
  const spawns: Array<{ command: string; args: readonly string[] | undefined; key: string | undefined }> = [];
  const client = new MuseAgentClient(
    { executable: "/test/muse", version: "1.4.2" },
    {
      apiKey: () => null,
      env: { ...process.env, ...environment },
      ...options,
      spawn: (input) => {
        spawns.push({ command: input.command, args: input.args, key: input.env?.META_API_KEY });
        return spawnMspConnection({
          ...input,
          command: process.execPath,
          args: ["-e", HOST],
          env: { ...input.env, MUSE_TEST_STATE: statePath, MUSE_TEST_FINGERPRINT: EXPECTED_SCHEMA_FINGERPRINT },
        });
      },
    },
  );
  clients.push(client);
  client.start();
  const notifications: AppServerNotification[] = [];
  client.on("notification", (event) => notifications.push(event));
  return { client, notifications, directory, statePath, spawns };
}
function completion(client: MuseAgentClient): Promise<AppServerNotification> {
  return new Promise((resolve, reject) => {
    const onEvent = (event: AppServerNotification) => {
      if (event.method !== "turn/completed") return;
      client.off("notification", onEvent);
      client.off("exit", reject);
      resolve(event);
    };
    client.on("notification", onEvent);
    client.once("exit", reject);
  });
}

describe("Muse native MSP adapter", () => {
  it("reads final durable items before completion and keeps the session after process release", async () => {
    const { client, directory, notifications, spawns } = await fixture();
    const opened = await runCauseEffect(
      client.request("thread/start", { cwd: directory, dynamicTools: [] }, decodeThreadResponse),
    );
    const done = completion(client);
    const turn = await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: opened.thread.id, input: [{ type: "text", text: "hello" }] },
        decodeTurnResponse,
      ),
    );
    await done;
    expect(notifications.find((event) => event.method === "item/completed")?.params).toMatchObject({
      item: { text: "Recovered answer" },
    });
    expect(notifications.at(-1)?.method).toBe("turn/completed");
    await runCauseEffect(client.releaseThread(opened.thread.id));
    await runCauseEffect(
      client.request(
        "thread/resume",
        { threadId: opened.thread.id, cwd: directory, dynamicTools: [] },
        decodeThreadResponse,
      ),
    );
    const history = await runCauseEffect(
      client.request("thread/read", { threadId: opened.thread.id, includeTurns: true }, decodeThreadResponse),
    );
    expect(history.thread.turns?.[0]).toMatchObject({ id: turn.turn.id, items: [{ text: "Recovered answer" }] });
    expect(spawns).toHaveLength(2);
  });

  it("recovers a missing view page before it publishes the terminal", async () => {
    const { client, directory, notifications } = await fixture({}, { MUSE_TEST_GAP: "1" });
    const opened = await runCauseEffect(client.request("thread/start", { cwd: directory }, decodeThreadResponse));
    const done = completion(client);
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: opened.thread.id, input: [{ type: "text", text: "hello" }] },
        decodeTurnResponse,
      ),
    );
    await done;
    expect(notifications.filter((event) => event.method === "item/completed")).toHaveLength(1);
    expect(notifications.at(-1)?.method).toBe("turn/completed");
  });

  it("rejects history from a different session without publishing a successful terminal", async () => {
    const { client, directory, notifications } = await fixture(
      {},
      { MUSE_TEST_GAP: "1", MUSE_TEST_WRONG_SESSION: "1" },
    );
    const opened = await runCauseEffect(client.request("thread/start", { cwd: directory }, decodeThreadResponse));
    const failed = new Promise<Error>((resolve) => client.once("exit", resolve));
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: opened.thread.id, input: [{ type: "text", text: "hello" }] },
        decodeTurnResponse,
      ),
    );
    await failed;
    expect(notifications.some((event) => event.method === "turn/completed")).toBe(false);
  });

  it("does not launch a profile session that could inherit external tools", async () => {
    const { client, spawns } = await fixture({ profileGeneration: true });
    await expect(runCauseEffect(client.request("initialize", {}, decodeRecordResponse))).rejects.toThrow();
    expect(spawns).toHaveLength(0);
  });

  it("redacts credentials from a failed turn sent to the user", async () => {
    const { client, directory, notifications } = await fixture(
      { apiKey: () => "fixture-private-key" },
      { MUSE_TEST_ERROR: "1" },
    );
    const opened = await runCauseEffect(client.request("thread/start", { cwd: directory }, decodeThreadResponse));
    const done = completion(client);
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: opened.thread.id, input: [{ type: "text", text: "hello" }] },
        decodeTurnResponse,
      ),
    );
    await done;
    expect(notifications.some((event) => event.method === "error")).toBe(true);
    expect(JSON.stringify(notifications)).not.toContain("fixture-private-key");
    expect(notifications.at(-1)?.params).toMatchObject({ turn: { status: "failed" } });
  });

  it("uses the explicit API key and confined command, and does not infer auth from models", async () => {
    const { client, directory, spawns, statePath } = await fixture(
      {
        apiKey: () => "fixture-explicit-key",
        confine: (target) => ({ ...target, command: "/test/sandbox", args: [target.command, ...target.args] }),
        readAccount: () => Effect.succeed({ authenticated: false }),
      },
      { META_API_KEY: "fixture-inherited-key" },
    );
    await runCauseEffect(
      client.request(
        "thread/start",
        { cwd: directory, dynamicTools: [{ type: "namespace", name: "openbot", tools: [] }] },
        decodeThreadResponse,
      ),
    );
    expect(spawns[0]).toMatchObject({ command: "/test/sandbox", key: "fixture-explicit-key" });
    expect(spawns[0]?.args?.[0]).toBe("/test/muse");
    const state = decodeRecordResponse(JSON.parse(await readFile(statePath, "utf8")));
    expect(state.mcp).toMatchObject({ openbot: { transport: "streamableHttp" } });
    const account = await runCauseEffect(client.request("account/read", {}, decodeAccountReadResult));
    expect(account.account).toBeNull();
  });
});
