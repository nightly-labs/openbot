// Runs saved agent settings through the Hermes driver and an isolated fake ACP process.
// No installed Hermes process, profile, credential, or model endpoint is used.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, isAgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { listHermesProfiles, resolveHermesRuntime } from "../src/backend/hermes-profiles";
import { MailboxStore } from "../src/backend/mailbox-store";
import { hermesRoot, hermesStatePathsForHome } from "../src/backend/process-confinement";
import { decodeModelListResponse, decodeRecordResponse } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { parseUpdateAgent } from "../src/main/ipc/agent-inputs";

const out = resolve(import.meta.dirname, "../.openbot-build/hermes-profiles-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-hermes-profiles-"));
const clients: AgentClient[] = [];
const store = new AgentStore(join(root, "state"), join(root, "home"));
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };
const previousHome = process.env.HERMES_HOME;
const previousCli = process.env.OPENBOT_HERMES_PATH;
let service: AgentService | undefined;
try {
  const hermes = join(root, "hermes");
  const named = join(hermes, "profiles", "work");
  await mkdir(named, { recursive: true });
  await writeFile(join(named, "config.yaml"), "agent:\n  coding_context: off\n");
  await writeFile(join(hermes, "config.yaml"), "agent:\n  disabled_toolsets: []\n");
  await writeFile(join(hermes, "active_profile"), "work\n");
  process.env.HERMES_HOME = hermes;
  const executable = join(root, "hermes-fake.mjs");
  const log = join(root, "launch.jsonl");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) { process.stdout.write('Hermes Agent v0.23.0\\n'); process.exit(0); }
const log = ${JSON.stringify(log)};
const argv = process.argv.slice(2);
const selected = argv.includes('--profile') ? argv[argv.indexOf('--profile')+1] : undefined;
const inherited = process.env.HERMES_HOME;
const root = basename(dirname(inherited)) === 'profiles' ? dirname(dirname(inherited)) : inherited;
let home = inherited;
if (selected) home = selected === 'default' ? root : join(root,'profiles',selected);
else if (home === root && existsSync(join(root,'active_profile'))) { const id=readFileSync(join(root,'active_profile'),'utf8').trim(); if(id && id !== 'default') home=join(root,'profiles',id); }
const named = basename(dirname(home)) === 'profiles';
const effort = named ? 'high' : 'low';
const signedOut=!selected && existsSync(join(root,'global-signed-out'));
const availableModels = [{modelId:'nous:fixture',name:named?'Work fixture':'Default fixture'},{modelId:named?'nous:work-only':'nous:default-only',name:named?'Work only':'Default only'}];
const record = value => appendFileSync(log, JSON.stringify({pid:process.pid,home,...value}) + '\\n');
record({event:'launch',argv,managed:process.env.HERMES_MANAGED_DIR});
const counter=join(home,'.fixture-session-count');
let count=existsSync(counter)?Number(readFileSync(counter,'utf8')):0;
const nextSession=()=>{writeFileSync(counter,String(++count));return 'fixture-session-'+count;};
const setup = id => ({sessionId:id,models:{currentModelId:availableModels[0].modelId,availableModels},modes:{currentModeId:'agent',availableModes:[{id:'agent',name:'Agent'}]},configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:availableModels[0].modelId,options:availableModels.map(m=>({value:m.modelId,name:m.name}))},{id:'effort',name:'Effort',category:'thought_level',type:'select',currentValue:effort,options:[{value:effort,name:effort}]},{id:'fixture-profile',name:'Fixture profile',type:'select',currentValue:named?'work':'default',options:[{value:'work',name:'Work'},{value:'default',name:'Default'}]}]});
createInterface({input:process.stdin}).on('line', line => {
  const req = JSON.parse(line);
  record({event:req.method,params:req.params});
  if(req.id === undefined) return;
  const result = req.method === 'initialize' ? {protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{resume:{}}},authMethods:[{id:signedOut?'hermes-setup':'configured',name:'Configured'}]} : req.method === 'session/new' ? setup(nextSession()) : req.method === 'session/load' ? setup(req.params.sessionId) : req.method === 'session/set_config_option' ? {configOptions:setup('').configOptions} : req.method === 'session/prompt' ? {stopReason:'end_turn'} : {};
  if(req.method === 'session/prompt') process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:req.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Fixture reply.'}}}})+'\\n');
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');
});
`,
  );
  await chmod(executable, 0o700);
  await runCauseEffect(store.initialize());
  const agent = await runCauseEffect(
    store.createAgent({ name: "Profile fixture", description: "Test", avatarSeed: "fixture", avatarHue: null }),
  );
  assert.equal(agent.hermesProfileId, undefined, "legacy absence stays absent");
  await runCauseEffect(store.updateAgent({ agentId: agent.id, provider: "hermes", hermesProfileId: "default" }));
  store.database.close();
  const reopened = new AgentStore(join(root, "state"), join(root, "home"));
  await runCauseEffect(reopened.initialize());
  try {
    const saved = reopened.list().find((item) => item.id === agent.id);
    assert.equal(saved?.hermesProfileId, "default", "explicit default must survive the saved agent roundtrip");
    report.checks.push("saved explicit default roundtrip");
    const driver = requireProviderDriver("hermes");
    const client = driver.createClient({ executable, version: "fixture", source: "system" }, 5_000, {
      ...NO_PROVIDER_CREDENTIALS,
      providerStateDirectory: join(root, "provider-state"),
      hermesProfile: resolveHermesRuntime(saved.hermesProfileId),
    });
    clients.push(client);
    client.start();
    await runCauseEffect(client.request("initialize", {}, decodeRecordResponse));
    const launch: { argv: string[]; home: string } = JSON.parse((await readFile(log, "utf8")).split("\n")[0] ?? "{}");
    assert.deepEqual(
      launch.argv,
      ["--profile", "default", "acp"],
      "saved explicit default must reach the actual ACP launcher argv",
    );
    assert.equal(launch.home, hermes, "explicit default must use the root even with a sticky named profile");
    report.checks.push("saved explicit default reaches actual ACP argv and home");
    const rows = () =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map(
          (
            line,
          ): {
            event: string;
            home: string;
            pid: number;
            argv?: string[];
            managed?: string;
            params?: { sessionId?: string };
          } => JSON.parse(line),
        );
    const open = async (profileId: string | undefined) => {
      const child = driver.createClient({ executable, version: "fixture", source: "system" }, 5_000, {
        ...NO_PROVIDER_CREDENTIALS,
        providerStateDirectory: join(root, "provider-state"),
        hermesProfile: resolveHermesRuntime(profileId),
      });
      clients.push(child);
      child.start();
      await runCauseEffect(child.request("initialize", {}, decodeRecordResponse));
      return child;
    };
    const start = async (child: AgentClient) => {
      const response = await runCauseEffect(
        child.request("thread/start", { cwd: root, model: "nous:fixture" }, decodeRecordResponse),
      );
      assert.ok(
        response.thread &&
          typeof response.thread === "object" &&
          "id" in response.thread &&
          typeof response.thread.id === "string",
      );
      return response.thread.id;
    };
    const work = await open("work");
    const defaultSession = await start(client);
    const workSession = await start(work);
    assert.notEqual(
      defaultSession,
      workSession,
      "same raw ACP IDs from different profiles must have distinct saved identities",
    );
    assert.ok(defaultSession.startsWith("hermes:") && workSession.startsWith("hermes:"));
    await assert.rejects(
      runCauseEffect(
        work.request(
          "thread/resume",
          { threadId: defaultSession, cwd: root, model: "nous:fixture" },
          decodeRecordResponse,
        ),
      ),
      /ACP session not found/,
    );
    await assert.rejects(
      runCauseEffect(
        work.readHistory?.({ threadId: defaultSession, items: "full", cwd: root }, () => Effect.succeed(true)) ??
          Effect.void,
      ),
      /ACP session not found/,
    );
    const restarted = await open("default");
    await runCauseEffect(
      restarted.request(
        "thread/resume",
        { threadId: defaultSession, cwd: root, model: "nous:fixture" },
        decodeRecordResponse,
      ),
    );
    assert.ok(
      rows().some(
        (row) =>
          row.event === "session/load" &&
          row.home === hermes &&
          row.params?.sessionId === defaultSession.split(":").at(-1),
      ),
    );
    report.checks.push(
      "profile namespace prevents cross-profile resume and history, same profile restart resumes raw session",
    );
    const inherited = await open(undefined);
    assert.deepEqual(
      rows()
        .filter((row) => row.event === "launch")
        .at(-1)?.argv,
      ["acp"],
    );
    const inheritedSession = await start(inherited);
    assert.ok(!inheritedSession.startsWith("hermes:"), "absence keeps released raw session identity");
    const workModels = await runCauseEffect(work.request("model/list", {}, decodeModelListResponse));
    const defaultModels = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
    assert.ok(workModels.data.some((model) => model.model === "nous:work-only"));
    assert.ok(!defaultModels.data.some((model) => model.model === "nous:work-only"));
    const overlays = rows().filter((row) => row.event === "launch" && row.managed);
    const defaultOverlay = overlays.find((row) => row.home === hermes)?.managed;
    const namedOverlay = overlays.find((row) => row.home === named)?.managed;
    assert.ok(defaultOverlay && namedOverlay && defaultOverlay !== namedOverlay);
    assert.match(await readFile(join(defaultOverlay, "config.yaml"), "utf8"), /coding_context/);
    assert.doesNotMatch(await readFile(join(defaultOverlay, "config.yaml"), "utf8"), /disabled_toolsets/);
    assert.doesNotMatch(await readFile(join(namedOverlay, "config.yaml"), "utf8"), /coding_context/);
    report.checks.push("unset argv, selected model discovery, and managed overlays use effective profile home");
    assert.deepEqual(listHermesProfiles(), ["default", "work"]);
    await mkdir(join(hermes, "profiles", "ghost"));
    await mkdir(join(hermes, "profiles", ".deleted"));
    await writeFile(join(hermes, "profiles", ".deleted", "work"), "");
    assert.deepEqual(listHermesProfiles(), ["default"]);
    assert.throws(() => resolveHermesRuntime("work"), /missing, deleted, or unavailable/);
    assert.throws(() => resolveHermesRuntime("ghost"), /missing, deleted, or unavailable/);
    assert.throws(() => resolveHermesRuntime("../escape"), /not valid/);
    assert.throws(() => listHermesProfiles({ HERMES_HOME: join(root, "missing-root") }), /could not list/);
    const removed = driver.createClient({ executable, version: "fixture" }, 5_000, {
      ...NO_PROVIDER_CREDENTIALS,
      hermesProfile: { profileId: "gone", home: join(hermes, "profiles", "gone"), identity: "gone" },
    });
    assert.throws(() => removed.start(), /missing, deleted, or unavailable/);
    assert.equal(
      existsSync(join(hermes, "profiles", "gone")),
      false,
      "failed explicit launch must not create a ghost profile",
    );
    await rm(join(hermes, "profiles", ".deleted", "work"));
    assert.equal(hermesRoot({ HERMES_HOME: named }), hermes);
    assert.equal(hermesRoot({ HERMES_DATA_DIR_SUFFIX: "-test" }, root, "linux"), join(root, ".hermes-test"));
    assert.equal(
      hermesRoot({ LOCALAPPDATA: join(root, "local"), HERMES_DATA_DIR_SUFFIX: "-test" }, root, "win32"),
      join(root, "local", "hermes-test"),
    );
    assert.equal(hermesRoot({ HERMES_HOME: "$FIXTURE_ROOT/hermes", FIXTURE_ROOT: root }), hermes);
    const statePaths = hermesStatePathsForHome(named);
    assert.deepEqual(statePaths.writable, [named]);
    assert.ok(statePaths.protected.includes(join(named, "config.yaml")));
    assert.throws(() => parseUpdateAgent({ agentId: agent.id, hermesProfileId: "../escape" }), /not valid/);
    assert.equal(isAgentSummary({ ...saved, hermesProfileId: "../escape" }), false);
    report.checks.push(
      "discovery rejects tombstones, ghosts, invalid IDs and unavailable roots without creating profiles",
    );
    await runCauseEffect(reopened.updateAgent({ agentId: agent.id, provider: "codex" }));
    assert.equal(
      reopened.list().find((row) => row.id === agent.id)?.hermesProfileId,
      "default",
      "provider changes keep Hermes selection dormant",
    );
    await runCauseEffect(reopened.updateAgent({ agentId: agent.id, hermesProfileId: null }));
    assert.equal(reopened.list().find((row) => row.id === agent.id)?.hermesProfileId, undefined);
    report.checks.push("dormant settings and null reset preserve provider conventions");
    process.env.OPENBOT_HERMES_PATH = executable;
    const serviceStore = new AgentStore(join(root, "service-state"), join(root, "service-home"));
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
    service = new AgentService({
      store: serviceStore,
      mailbox: new MailboxStore(join(root, "service-state"), serviceStore.sharedRoot, serviceStore.database),
      browser,
      preferredProvider: "hermes",
      offProviders: AGENT_PROVIDERS.filter((id) => id !== "hermes"),
      credentials: { ...NO_PROVIDER_CREDENTIALS, providerStateDirectory: join(root, "service-providers") },
    });
    const app = service;
    const idle = async (agentId: string) => {
      const done = () =>
        app.listQueue(agentId).deliveries.every((row) => !["queued", "starting", "running"].includes(row.status));
      if (done()) return;
      await new Promise<void>((finish, reject) => {
        const timer = setTimeout(() => {
          app.off("event", changed);
          reject(new Error("Service fixture did not become idle."));
        }, 20_000);
        const changed = () => {
          if (done()) {
            clearTimeout(timer);
            app.off("event", changed);
            finish();
          }
        };
        app.on("event", changed);
        changed();
      });
    };
    await writeFile(join(hermes, "global-signed-out"), "");
    await runCauseEffect(app.initialize());
    const create = (name: string, hermesProfileId: string) =>
      runCauseEffect(
        app.createAgent({
          name,
          description: "Fixture",
          avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
          avatarHue: null,
          provider: "hermes",
          model: "nous:fixture",
          hermesProfileId,
          initialMessage: "Hello",
        }),
      );
    const a = await create("Default fixture", "default");
    await idle(a.id);
    const b = await create("Work fixture", "work");
    await idle(b.id);
    const get = (id: string) => {
      const row = app.listAgents().find((agent) => agent.id === id);
      assert.ok(row);
      return row;
    };
    const sessionA = () => serviceStore.activeProviderSession(a.id)?.externalSessionId;
    const initialThread = get(a.id).threadId;
    const first = sessionA();
    assert.ok(first);
    assert.equal((await runCauseEffect(app.readAgentSessionSettings(a.id))).providerIdentity, "hermes:default");
    assert.equal(
      (await runCauseEffect(app.readAgentSessionSettings(b.id))).options.find(
        (option) => option.id === "fixture-profile",
      )?.currentValue,
      "work",
    );
    const other = serviceStore.activeProviderSession(b.id)?.externalSessionId;
    assert.ok(other && other !== first);
    const catalogsA = await runCauseEffect(app.listHermesModels("default"));
    const catalogsB = await runCauseEffect(app.listHermesModels("work"));
    assert.equal(catalogsA.find((model) => model.id === "nous:fixture")?.defaultReasoningEffort, "low");
    assert.equal(catalogsB.find((model) => model.id === "nous:fixture")?.defaultReasoningEffort, "high");
    assert.ok(!catalogsA.some((model) => model.id === "nous:work-only"));
    await assert.rejects(runCauseEffect(app.updateAgent({ agentId: a.id, model: "nous:work-only" })));
    assert.equal(get(a.id).model, "nous:fixture", "another profile catalog cannot validate this model");
    await runCauseEffect(app.sendMessage({ agentId: a.id, text: "Same profile" }));
    await idle(a.id);
    assert.equal(sessionA(), first, "unchanged selection reuses session");
    for (const profile of ["work", "default"]) {
      await runCauseEffect(app.updateAgent({ agentId: a.id, hermesProfileId: profile }));
      assert.equal(sessionA(), undefined, "profile switch retires the active continuation");
      await runCauseEffect(app.sendMessage({ agentId: a.id, text: "Changed profile" }));
      await idle(a.id);
      const next = sessionA();
      assert.ok(next && next !== first, "A to B to A starts a fresh continuation");
      assert.equal(
        (await runCauseEffect(app.readAgentSessionSettings(a.id))).options.find(
          (option) => option.id === "fixture-profile",
        )?.currentValue,
        profile,
      );
      assert.equal(
        get(a.id).reasoningEffort,
        profile === "work" ? "high" : "low",
        "profile switch selects a supported saved effort",
      );
      assert.equal(get(a.id).id, a.id);
      assert.equal(get(a.id).threadId, initialThread);
    }
    assert.equal(
      serviceStore.activeProviderSession(b.id)?.externalSessionId,
      other,
      "another agent keeps its own continuation",
    );
    assert.ok(
      serviceStore.database.readConversationPage(a.id, get(a.id).threadId, { type: "latest" }, 100).messages.length >=
        4,
      "conversation data survives profile changes",
    );
    await writeFile(join(hermes, "profiles", ".deleted", "work"), "");
    await assert.rejects(
      runCauseEffect(app.updateAgent({ agentId: a.id, hermesProfileId: "work" })),
      /missing, deleted, or unavailable/,
    );
    assert.equal(get(a.id).hermesProfileId, "default", "failed selection preserves saved choice");
    await rm(join(hermes, "profiles", ".deleted", "work"));
    report.checks.push(
      "real AgentService: two agents, profile-specific model efforts, reuse, A to B to A handoff, preserved history and failed switch",
    );
    await runCauseEffect(app.stop());
    service = undefined;
    const corruptPath = join(root, "corrupt-state");
    const corrupt = new AgentStore(corruptPath, join(root, "corrupt-home"));
    await runCauseEffect(corrupt.initialize());
    corrupt.database.replaceAgents(
      "fixture-corrupt",
      [{ ...get(a.id), hermesProfileId: "../escape" }],
      "fixture.corrupt",
    );
    corrupt.database.close();
    const unreadable = new AgentStore(corruptPath, join(root, "corrupt-home"));
    try {
      await assert.rejects(runCauseEffect(unreadable.initialize()), /hermesProfileId/);
    } finally {
      unreadable.database.close();
    }
    report.checks.push("invalid saved explicit profile fails without reset to inheritance");
    serviceStore.database.close();
    report.passed = true;
  } finally {
    reopened.database.close();
  }
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (service) await runCauseEffect(service.stop()).catch(() => undefined);
  for (const client of clients) await runCauseEffect(client.stop());
  store.database.close();
  if (previousCli === undefined) delete process.env.OPENBOT_HERMES_PATH;
  else process.env.OPENBOT_HERMES_PATH = previousCli;
  if (previousHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = previousHome;
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  // Machine-readable: repeatable E2E result.
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
