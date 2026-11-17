// Runs the real local renderer store and host preference store in one isolated Node/JSDOM process.
// The existing desktop bridge is injected; no Electron process or provider request is used.
// Run: bun scripts/agent-message-routing-ui-e2e.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build", "agent-message-routing-ui-e2e");
mkdirSync(output, { recursive: true });
const entryPath = join(output, "fixture.mjs");
const modules = {
  solid: "solid-js",
  renderer: join(projectRoot, "src/renderer/src/features/conversation/stores/agent-message-routing-store.ts"),
  preferences: join(projectRoot, "src/main/custom-message-routing-preference-store.ts"),
  effects: join(projectRoot, "src/backend/effect-boundary.ts"),
  fixtures: join(projectRoot, "src/renderer/src/preview/fixtures.ts"),
};
let source =
  `const output = ${JSON.stringify(output)};\n` +
  String.raw`
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
const report = { passed: false, checks: [], writes: [], legacyWrites: 0, errors: [], limitations: [
  "Runs real renderer state and file persistence through an injected desktop bridge, without Electron.",
  "Two real store consumers prove preference/event synchronization. ServerAgentsSection and select rendering are covered separately by Storybook QA.",
] };
const disposers = [];
let listeners;
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function waitFor(label, read) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const result = read();
    if (result) return result;
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((done) => setImmediate(done));
  }
}
try {
  const { createRoot, createSignal, flush } = await IMPORT_SOLID;
  const { createAgentMessageRoutingStore } = await IMPORT_RENDERER;
  const { CustomMessageRoutingPreferenceStore, CUSTOM_MESSAGE_ROUTING_FILE } = await IMPORT_PREFERENCES;
  const { runCauseEffect } = await IMPORT_EFFECTS;
  const { STORY_AGENT_SUMMARIES } = await IMPORT_FIXTURES;
  const agents = STORY_AGENT_SUMMARIES.slice(0, 2).map((agent) => ({ ...agent, busyMessageMode: "queue" }));
  const [alpha, beta] = agents;
  assert.ok(alpha && beta);
  const profile = mkdtempSync(join(output, "profile-"));
  const path = join(profile, CUSTOM_MESSAGE_ROUTING_FILE);
  report.profile = profile;
  const preferenceOptions = { path, legacyDefault: () => "queue", agents: () => agents };
  const preferences = new CustomMessageRoutingPreferenceStore(preferenceOptions);
  await runCauseEffect(preferences.load());
  await runCauseEffect(preferences.set({ mode: "thread" }));
  listeners = new Set();
  let reads = 0;
  let gateNextRead = null;
  let failNextRead = false;
  function emit(serverId = "local", type = "agents-changed") {
    for (const listener of listeners) listener({ serverId, event: { type } });
  }
  window.openbot = {
    getCustomMessageRouting: async () => {
      reads++;
      if (failNextRead) { failNextRead = false; throw new Error("Isolated read failure"); }
      const snapshot = structuredClone(preferences.get());
      const gate = gateNextRead;
      gateNextRead = null;
      if (gate) { gate.entered.resolve(); await gate.released.promise; }
      return snapshot;
    },
    setCustomMessageRouting: async (input) => {
      report.writes.push(structuredClone(input));
      const settings = await runCauseEffect(preferences.set(input));
      emit();
      return structuredClone(settings);
    },
    agent: {
      onScopedEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      updateAgent: async () => { report.legacyWrites++; throw new Error("Custom controls must not write legacy agent fields"); },
    },
  };
  let primary, peer, setTarget, closePrimary;
  createRoot((dispose) => {
    closePrimary = dispose;
    disposers.push(dispose);
    const [target, changeTarget] = createSignal({ serverId: "local", agentId: alpha.id });
    setTarget = changeTarget;
    primary = createAgentMessageRoutingStore({ desktop: () => true, target, onError: (error) => report.errors.push(String(error)) });
  });
  createRoot((dispose) => {
    disposers.push(dispose);
    peer = createAgentMessageRoutingStore({ desktop: () => true, target: () => ({ serverId: "local", agentId: alpha.id }), onError: (error) => report.errors.push(String(error)) });
  });
  const current = (store) => { flush(); return store.current(); };
  await waitFor("both local consumers loaded", () => current(primary) && current(peer) && listeners.size === 2);
  assert.equal(current(primary).defaultMode, "thread");
  assert.equal(current(primary).mode, "queue", "The existing explicit legacy override must be displayed accurately.");
  report.checks.push("Initial custom state shows the actual saved agent override and Thread host default.");

  for (const mode of [null, "thread", "queue", null]) {
    await current(primary).onChange(mode);
    await waitFor("saved mode refreshed in both consumers", () => current(primary)?.mode === mode && current(peer)?.mode === mode && !current(primary).saving);
    const settings = await window.openbot.getCustomMessageRouting();
    assert.equal(settings.agents[alpha.id], mode);
    assert.equal(preferences.mode(alpha.id), mode ?? "thread");
    assert.equal(agents[0].busyMessageMode, "queue", "The released agent field must remain unchanged.");
  }
  assert.deepEqual(report.writes, [null, "thread", "queue", null].map((mode) => ({ agentIds: [alpha.id], mode })));
  report.checks.push("Default, Thread and Queue persist through the real host store, refresh both consumers, and leave the old Queue field intact.");

  await window.openbot.setCustomMessageRouting({ mode: "steer" });
  await waitFor("global changes refresh Advanced consumers", () => current(primary)?.defaultMode === "steer" && current(peer)?.defaultMode === "steer");
  assert.equal(preferences.mode(alpha.id), "steer");
  const beforeWrongServer = reads;
  emit("other-server");
  emit("local", "unrelated-fixture-event");
  flush();
  assert.equal(reads, beforeWrongServer);
  report.checks.push("A host default change refreshes both consumers; another server and unrelated events cause no read.");

  const gate = { entered: deferred(), released: deferred() };
  gateNextRead = gate;
  emit();
  await gate.entered.promise;
  // The delayed alpha read contains beta's old Queue value. A newer beta read must win.
  await runCauseEffect(preferences.set({ agentIds: [beta.id], mode: "thread" }));
  setTarget({ serverId: "local", agentId: beta.id });
  await waitFor("beta target loaded", () => current(primary)?.mode === "thread" && primary.ready());
  gate.released.resolve();
  await new Promise((done) => setImmediate(done));
  flush();
  assert.equal(current(primary).mode, "thread");
  assert.equal(current(peer).mode, null);
  await current(primary).onChange("queue");
  await waitFor("beta write complete", () => current(primary)?.mode === "queue" && !current(primary).saving);
  assert.equal(preferences.get().agents[alpha.id], null);
  assert.equal(preferences.get().agents[beta.id], "queue");
  report.checks.push("Switching agents rejects a late old read, preserves the other view, and saves only the new target.");

  const reloaded = new CustomMessageRoutingPreferenceStore(preferenceOptions);
  await runCauseEffect(reloaded.load());
  assert.deepEqual(reloaded.get(), preferences.get());
  const disk = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(disk.agents[alpha.id], null);
  assert.equal(disk.agents[beta.id], "queue");
  assert.equal(disk.mode, "steer");
  report.checks.push("A new real preference store reads the saved host default and both agent overrides from disk.");

  closePrimary();
  flush();
  assert.equal(listeners.size, 1);
  const beforeDisposedRead = reads;
  emit();
  await waitFor("remaining view refresh after disposal", () => { flush(); return reads === beforeDisposedRead + 1; });
  assert.equal(report.legacyWrites, 0);
  assert.deepEqual(report.errors, []);
  report.checks.push("Disposal removes the scoped listener; the remaining view still refreshes and no legacy updateAgent call occurs.");
  // A web/remote adapter supplies no local target and never subscribes to the desktop bridge.
  createRoot((dispose) => {
    disposers.push(dispose);
    const remote = createAgentMessageRoutingStore({ desktop: () => false, target: () => null, onError: (error) => report.errors.push(String(error)) });
    assert.equal(remote.current(), undefined);
  });
  flush();
  assert.equal(listeners.size, 1);
  report.checks.push("The runtime-injected remote/web path has no custom preference read or desktop subscription.");
  let failedView, closeFailedView;
  failNextRead = true;
  createRoot((dispose) => {
    closeFailedView = dispose;
    disposers.push(dispose);
    failedView = createAgentMessageRoutingStore({ desktop: () => true, target: () => ({ serverId: "local", agentId: alpha.id }), onError: (error) => report.errors.push(String(error)) });
  });
  await waitFor("read failure reported", () => { flush(); return report.errors.length === 1; });
  assert.equal(failedView.ready(), false);
  assert.equal(failedView.current(), undefined);
  assert.match(report.errors[0], /Isolated read failure/);
  closeFailedView();
  flush();
  assert.equal(listeners.size, 1);
  report.checks.push("An initial read failure reports an error and keeps editing unavailable instead of exposing a stale legacy Queue value.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  for (const dispose of disposers) dispose();
  if (listeners) report.remainingListeners = listeners.size;
  dom.window.close();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
}
`;
for (const [name, path] of Object.entries(modules)) {
  source = source.replaceAll(`IMPORT_${name.toUpperCase()}`, `import(${JSON.stringify(path.replaceAll("\\", "/"))})`);
}
writeFileSync(entryPath, source);
const build = await Bun.build({
  entrypoints: [entryPath],
  target: "node",
  format: "esm",
  conditions: ["browser"],
  external: ["jsdom"],
  outdir: output,
  naming: "fixture-bundle.mjs",
});
assert.ok(build.success, String(build.logs));
const child = spawnSync("node", [join(output, "fixture-bundle.mjs")], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
  timeout: 30_000,
});
process.stdout.write(child.stdout ?? "");
process.stderr.write(child.stderr ?? "");
assert.ifError(child.error);
assert.equal(child.status, 0, "Agent custom routing UI fixture failed.");
