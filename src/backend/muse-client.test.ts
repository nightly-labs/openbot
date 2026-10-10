import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXPECTED_SCHEMA_FINGERPRINT, spawnMspConnection } from "@muse-code/sdk";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { promptQuestions, promptResolution } from "./agent/prompts";
import { runCauseEffect } from "./effect-boundary";
import { MuseAgentClient, type MuseProviderOptions } from "./muse-client";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeAccountReadResult,
  decodeRecordResponse,
  decodeThreadResponse,
  decodeTurnResponse,
  getRecord,
  getString,
} from "./protocol";

/* Failure modes: the host loses final items; a gap hides an item; a page crosses sessions;
 * a credential answer enters shared history; an inherited key reaches the wrong account; MCP refresh leaves an old process alive.
 * live items, split deltas, and resumed history can expose provider credentials; redaction can damage IDs or usage.
 * These tests use the real SDK over a child-process boundary and a saved session fixture. */
const HOST = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
const statePath = process.env.MUSE_TEST_STATE;
const emit = (value) => process.stdout.write(JSON.stringify({jsonrpc:"2.0", ...value}) + "\n");
const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const secretText = state => process.env.MUSE_TEST_ECHO_SECRETS === "1" ? "prefix " + state.apiKey + " " + state.mcp.example.headers["X-Test"] + " suffix f" : "Recovered answer";
const item = (state) => ({itemId:"answer",kind:"agentMessage",revision:2,status:"completed",turnId:state.turnId,text:secretText(state)});
const items = state => process.env.MUSE_TEST_ECHO_SECRETS === "1" ? [
  item(state),
  {...item(state),itemId:"user",kind:"userMessage"},
  {...item(state),itemId:"tool",kind:"toolCall",tool:secretText(state),args:secretText(state),visibleOutput:secretText(state),failureReason:secretText(state)},
  {...item(state),itemId:"reasoning",kind:"reasoning",summary:[secretText(state)]},
  {...item(state),itemId:"shell",kind:"userShell",commandText:secretText(state),visibleOutput:secretText(state),exitCode:0},
] : [item(state)];
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
   if(process.env.MUSE_TEST_ECHO_SECRETS === "1") {
     for(const entry of items(state)) emit(event("item/started",state,{item:{...entry,revision:1,status:"inProgress"}}));
     for(const [itemId,field] of [["answer","text"],["reasoning","summary.0"],["tool","output"]]) {
       for(const secret of [state.apiKey,state.mcp.example.headers["X-Test"]]) {
         const split = Math.floor(secret.length/2);
         emit(event("item/delta",state,{itemId,field,delta:secret.slice(0,split)}));
         emit(event("item/delta",state,{itemId,field,delta:secret.slice(split)+" suffix"}));
       }
     }
     emit(event("session/tokenUsage",state,{turnId:state.turnId,cumulative:{promptTokens:123,outputTokens:7,totalTokens:130,cacheReadTokens:2,cacheWriteTokens:3}}));
   }
   if(process.env.MUSE_TEST_INPUT === "1") {
     emit(event("userInput/requested",state,{userInputId:"input-1",questions:[{id:"credential",header:"Account",question:"Enter your API key",options:[],selection:{mode:"single"}}]}));
     return;
   }
   if(process.env.MUSE_TEST_GAP === "1") {
     emit(event("view/gap",state,{after:"a",next:"c"}));
   } else {
     emit(event("item/started",state,{item:{...item(state),revision:1,status:"inProgress",text:"Partial"}}));
   }
   emit(event("turn/completed",state,{turnId:state.turnId,terminal: process.env.MUSE_TEST_ERROR === "1" ? "failed" : "completed", ...(process.env.MUSE_TEST_ERROR === "1" ? {error:{message:"Rejected key: " + process.env.META_API_KEY}} : {}), viewCursor:"c"}));
   return;
 }
 if(frame.method === "userInput/answer") {
   const state = readState(); fs.writeFileSync(statePath, JSON.stringify({...state,answers:p.answers}));
   emit({id:frame.id,result:{}});
   emit(event("turn/completed",state,{turnId:state.turnId,terminal:"completed"}));
   return;
 }
 if(frame.method === "session/read") {
   const state = readState(); result={session:{sessionId:state.sessionId},history:{mode:"inline",items:state.turnId ? items(state) : [],snapshot:null}};
 }
 if(frame.method === "view/page") {
   const state=readState();
   result={events:[...items(state).map(entry=>event("item/completed",state,{sessionId:process.env.MUSE_TEST_WRONG_SESSION === "1" ? "wrong" : state.sessionId,item:entry,viewCursor:"b"})),event("turn/completed",state,{turnId:state.turnId,terminal:"completed",viewCursor:"c"})],nextCursor:null};
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

  it("redacts live items, split deltas, and resumed history without changing protocol metadata", async () => {
    const apiKey = "fixture-muse-private-value";
    const mcpKey = "fixture-mcp-private-value";
    const { client, directory, notifications } = await fixture(
      {
        apiKey: () => apiKey,
        mcpServers: () => [
          {
            id: "example",
            name: "example",
            transport: "http",
            enabled: true,
            command: "",
            args: [],
            env: [],
            envPassthrough: [],
            workingDirectory: "",
            url: "https://example.test/mcp",
            headers: [{ key: "X-Test", value: mcpKey }],
          },
        ],
      },
      { MUSE_TEST_ECHO_SECRETS: "1" },
    );
    const opened = await runCauseEffect(client.request("thread/start", { cwd: directory }, decodeThreadResponse));
    const done = completion(client);
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: opened.thread.id, input: [{ type: "text", text: "echo" }] },
        decodeTurnResponse,
      ),
    );
    await done;
    for (const secret of [apiKey, mcpKey]) expect(JSON.stringify(notifications)).not.toContain(secret);
    for (const method of [
      "item/agentMessage/delta",
      "item/reasoning/summaryTextDelta",
      "item/commandExecution/outputDelta",
    ]) {
      const text = notifications
        .filter((event) => event.method === method)
        .map((event) => getString(event.params, "delta") ?? "")
        .join("");
      expect(text).toContain("suffix");
      for (const secret of [apiKey, mcpKey]) expect(text).not.toContain(secret);
    }
    expect(notifications.find((event) => event.method === "openbot/usage")?.params).toMatchObject({
      threadId: opened.thread.id,
      usage: { inputTokens: 123, outputTokens: 7, cachedReadTokens: 2, cachedWriteTokens: 3 },
    });
    expect(
      notifications.find(
        (event) => event.method === "item/completed" && getString(getRecord(event.params, "item"), "id") === "shell",
      )?.params,
    ).toMatchObject({ item: { id: "shell", exitCode: 0 } });
    await runCauseEffect(client.releaseThread(opened.thread.id));
    await runCauseEffect(
      client.request("thread/resume", { threadId: opened.thread.id, cwd: directory }, decodeThreadResponse),
    );
    const history = await runCauseEffect(
      client.request("thread/read", { threadId: opened.thread.id, includeTurns: true }, decodeThreadResponse),
    );
    for (const secret of [apiKey, mcpKey]) expect(JSON.stringify(history)).not.toContain(secret);
    expect(history.thread.turns?.[0]?.items).toHaveLength(5);
    expect(JSON.stringify(history)).toContain("prefix");
    expect(JSON.stringify(history)).toContain("suffix f");
  });

  it("keeps a credential answer out of the persisted prompt resolution", async () => {
    const { client, directory, statePath } = await fixture({}, { MUSE_TEST_INPUT: "1" });
    const opened = await runCauseEffect(client.request("thread/start", { cwd: directory }, decodeThreadResponse));
    const asked = new Promise<AppServerRequest>((resolve) => client.once("request", resolve));
    const done = completion(client);
    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: opened.thread.id, input: [{ type: "text", text: "connect" }] },
        decodeTurnResponse,
      ),
    );
    const request = await asked;
    const answers = { credential: ["fixture-private-answer"] };
    const persisted = promptResolution(promptQuestions(request.params), answers);
    expect(persisted).toMatchObject({ responses: { credential: { status: "answered" } } });
    expect(JSON.stringify(persisted)).not.toContain("fixture-private-answer");
    client.respond(request.id, { answers: { credential: { answers: answers.credential } } });
    await done;
    const state = decodeRecordResponse(JSON.parse(await readFile(statePath, "utf8")));
    expect(state.answers).toEqual([{ questionId: "credential", freeText: "fixture-private-answer" }]);
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
