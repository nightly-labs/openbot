import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";

const root = await mkdtemp(join(tmpdir(), "openbot-acp-user-"));
const fixture = join(root, "agent.cjs");
const log = join(root, "wire.jsonl");
const shell = join(root, "agent");
let client: AgentClient | undefined;
try {
  await writeFile(
    fixture,
    `const fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});\nconst log=${JSON.stringify(log)};let n=0;rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;fs.appendFileSync(log,JSON.stringify({method:m.method,params:m.params})+'\\n');const send=(result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');if(m.method==='initialize')send({protocolVersion:1,agentInfo:{name:'fixture',version:'1'},agentCapabilities:{}});else if(m.method==='session/new')send({sessionId:'session-'+(++n)});else if(m.method==='session/prompt')send({stopReason:'end_turn'});else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'unsupported'}})+'\\n')});`,
  );
  await writeFile(shell, `#!/bin/sh\nexec '${process.execPath}' '${fixture}'\n`);
  await chmod(shell, 0o700);
  const agents = [{ id: "fixture", name: "fixture", command: shell, args: [], env: [], usagePrompt: null }];
  client = requireProviderDriver("acp").createClient(
    { executable: "acp", version: "fixture" },
    15000,
    { apiKey: () => null, customProviders: () => [], mcpServers: () => [], customAgents: () => agents },
    undefined,
  );
  client.start();
  const opened = await runCauseEffect(
    client.request(
      "thread/start",
      {
        cwd: root,
        model: "fixture/default",
        openbotAuthenticatedUserId: "member-a",
      },
      (value) => value,
    ),
  );
  const id = isRecord(opened) ? getString(opened.thread, "id") : null;
  assert.ok(id);
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("turn timed out")), 10000);
    client?.on("notification", (event) => {
      if (event.method === "turn/completed" && getString(event.params, "threadId") === id) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      {
        threadId: id,
        model: "fixture/default",
        openbotAuthenticatedUserId: "member-a",
        input: [{ type: "text", text: "hello" }],
      },
      (value) => value,
    ),
  );
  await done;
  const wire = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const session = wire.find((entry) => entry.method === "session/new" && entry.params._meta?.["openbot.dev/userId"]);
  const prompt = wire.find((entry) => entry.method === "session/prompt");
  assert.equal(session?.params._meta["openbot.dev/userId"], "member-a");
  assert.equal(prompt?.params._meta["openbot.dev/userId"], "member-a");
  const openedAnonymous = await runCauseEffect(
    client.request("thread/start", { cwd: root, model: "fixture/default" }, (value) => value),
  );
  const anonymousId = isRecord(openedAnonymous) ? getString(openedAnonymous.thread, "id") : null;
  assert.ok(anonymousId);
  const anonymousDone = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("anonymous turn timed out")), 10000);
    client?.on("notification", (event) => {
      if (event.method === "turn/completed" && getString(event.params, "threadId") === anonymousId) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await runCauseEffect(
    client.request(
      "turn/start",
      {
        threadId: anonymousId,
        model: "fixture/default",
        input: [{ type: "text", text: "mixed batch" }],
      },
      (value) => value,
    ),
  );
  await anonymousDone;
  const after = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const anonymousSession = after.filter((entry) => entry.method === "session/new").at(-1);
  const anonymousPrompt = after.filter((entry) => entry.method === "session/prompt").at(-1);
  assert.equal(anonymousSession?.params._meta?.["openbot.dev/userId"], undefined);
  assert.equal(anonymousPrompt?.params._meta?.["openbot.dev/userId"], undefined);
  process.stdout.write("ACP metadata is present for one member and absent for an unattributed batch.\n");
} finally {
  if (client) await runCauseEffect(client.stop());
  await rm(root, { recursive: true, force: true });
}
