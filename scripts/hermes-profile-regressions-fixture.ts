import { existsSync, readFileSync, watch } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const launchRow = z.object({
  pid: z.number().int().positive(),
  home: z.string(),
  event: z.string(),
  argv: z.array(z.string()).optional(),
});

export function launchRows(log: string) {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => launchRow.parse(JSON.parse(line)));
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function waitFor(directory: string, predicate: () => boolean, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = watch(directory, () => {
      if (predicate()) finish();
    });
    const timeout = setTimeout(() => finish(new Error(`Did not reach ${label}.`)), 20_000);
    function finish(error?: Error) {
      observer.close();
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    }
    observer.on("error", finish);
    if (predicate()) finish();
  });
}

export async function fakeHermes(root: string): Promise<string> {
  const executable = join(root, "hermes-fake.mjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, existsSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) { process.stdout.write('Hermes Agent v0.23.0\\n'); process.exit(0); }
const root = ${JSON.stringify(root)};
const log = join(root, 'launch.jsonl');
const argv = process.argv.slice(2);
const profile = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : undefined;
const envHome = process.env.HERMES_HOME;
const hermes = basename(dirname(envHome)) === 'profiles' ? dirname(dirname(envHome)) : envHome;
const home = profile === undefined ? envHome : profile === 'default' ? hermes : join(hermes, 'profiles', profile);
const record = event => appendFileSync(log, JSON.stringify({pid:process.pid,home,event,argv}) + '\\n');
record('launch');
let sessions = 0;
const latched = profile === 'work' && existsSync(join(root, 'latch-enabled'));
const model = {modelId:'nous:fixture',name:'Fixture'};
const setup = () => ({sessionId:'fixture-'+process.pid+'-'+sessions,models:{currentModelId:model.modelId,availableModels:[model]},modes:{currentModeId:'agent',availableModes:[{id:'agent',name:'Agent'}]},configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:model.modelId,options:[{value:model.modelId,name:model.name}]}]});
const reply = req => {
  const result = req.method === 'initialize' ? {protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{resume:{}}},authMethods:[{id:'configured',name:'Configured'}]} : req.method === 'session/new' || req.method === 'session/load' ? setup() : req.method === 'session/set_config_option' ? {configOptions:setup().configOptions} : {};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');
};
const input = createInterface({input:process.stdin});
input.on('close', () => {record('stdin-end');process.exit(0);});
process.on('SIGTERM', () => {record('sigterm');process.exit(0);});
input.on('line', line => {
  const req = JSON.parse(line);
  record(req.method);
  if (req.id === undefined) return;
  if (req.method === 'session/new' && ++sessions === 2 && latched) {
    record('blocked');
    writeFileSync(join(root,'blocked.json'), JSON.stringify({pid:process.pid}));
    let released = false;
    const release = () => {
      if (released || !existsSync(join(root,'release'))) return;
      released = true;
      observer.close();
      record('released');
      reply(req);
    };
    const observer = watch(root, release);
    release();
    return;
  }
  reply(req);
});
`,
  );
  await chmod(executable, 0o700);
  return executable;
}

export async function seedAgents(root: string) {
  const store = new AgentStore(join(root, "service-state"), join(root, "service-home"));
  await runCauseEffect(store.initialize());
  const agents: string[] = [];
  try {
    for (const hermesProfileId of ["work", "default"]) {
      const agent = await runCauseEffect(
        store.createAgent({
          name: `${hermesProfileId} fixture`,
          description: "Fixture",
          avatarSeed: hermesProfileId,
          avatarHue: null,
        }),
      );
      await runCauseEffect(
        store.updateAgent({ agentId: agent.id, provider: "hermes", model: "nous:fixture", hermesProfileId }),
      );
      agents.push(agent.id);
    }
    return agents;
  } finally {
    store.database.close();
  }
}

export async function makeService(root: string) {
  const hermes = join(root, "hermes");
  await mkdir(join(hermes, "profiles", "work"), { recursive: true });
  await writeFile(join(hermes, "profiles", "work", "config.yaml"), "agent: {}\n");
  await writeFile(join(hermes, "config.yaml"), "agent: {}\n");
  process.env.HERMES_HOME = hermes;
  process.env.OPENBOT_HERMES_PATH = await fakeHermes(root);
  const store = new AgentStore(join(root, "service-state"), join(root, "service-home"));
  const unused = () => Effect.die(new Error("Unused fixture boundary."));
  const browser: AgentBrowserHost = {
    listTabs: () => [],
    beginTakeover: unused,
    endTakeover: () => {},
    resolveUploadTarget: unused,
    handleDynamicTool: unused,
    userControlTabFor: () => null,
    awaitUserControlRelease: unused,
    onChanged: () => () => {},
    onControlChanged: () => () => {},
    onDocumentChanged: () => () => {},
    clearControls: () => {},
    endControl: () => {},
    close: () => Effect.void,
    clearAgentSession: () => Effect.void,
    shareTab: () => undefined,
    unshareThread: () => undefined,
    agentTab: () => null,
  };
  const service = new AgentService({
    store,
    mailbox: new MailboxStore(join(root, "service-state"), store.sharedRoot, store.database),
    browser,
    preferredProvider: "hermes",
    offProviders: AGENT_PROVIDERS.filter((id) => id !== "hermes"),
    credentials: { ...NO_PROVIDER_CREDENTIALS, providerStateDirectory: join(root, "service-providers") },
  });
  return { service, store };
}
