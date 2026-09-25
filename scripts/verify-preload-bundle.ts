import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { groupApiMethodName, IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";

// Runs the built preload bundles in a VM with a fake Electron, after `bun run build`. The types
// describe the source; this reads what the renderer really gets. It fails when the bundle:
// - loads a module that a sandboxed preload cannot load, or loads code with `import()`;
// - exposes a world other than `openbot`, or a value other than a function or a method group;
// - exposes a method that `IPC_ENDPOINTS` and the hand-written list below do not name, or omits one;
// - sends a method to a channel other than the channel of its endpoint.

type IpcGroupName = keyof typeof IPC_ENDPOINTS;

// Where `src/preload/index.ts` puts each endpoint group. The empty path is the top of `window.openbot`.
// A new group does not compile until it has a place, so that the author decides what the page can call.
const GROUP_PATHS: Readonly<Record<IpcGroupName, string | null>> = {
  app: "",
  providers: "",
  maintenance: "maintenance",
  providerRuntimes: "providerRuntimes",
  voice: "voice",
  dynamicIsland: "dynamicIsland",
  computerUse: "computerUse",
  skills: "skills",
  customProviders: "customProviders",
  hostedSites: "hostedSites",
  marketplaceAgents: "marketplaceAgents",
  agentTemplates: "agentTemplates",
  auth: "auth",
  update: "update",
  notifications: "notifications",
  agent: "agent",
  agentMemories: "agent",
  sharedTables: "agent",
  agentRoutines: "agent",
  channelMemories: "agent",
  channelRoutines: "agent",
  mcpServers: "agent",
  agentAttachments: "agent",
  // The preload calls it from its own drop, paste, and file input handlers.
  attachmentImports: null,
  browser: "browser",
  browserInput: "browser",
  servers: "servers",
  storage: "storage",
  agentImport: "agentImport",
  plugins: "plugins",
  host: "host",
  remoteDesktop: "remoteDesktop",
};

// Methods that `src/preload/index.ts` writes by hand. Each one narrows a bridged event.
const HAND_WRITTEN_METHODS = [
  "agent.onAttachmentImport",
  "agent.onEvent",
  "servers.onPresence",
  "servers.onDirectMessage",
  "servers.onDirectTyping",
];

// The modules that Electron gives a sandboxed preload.
const SANDBOX_MODULES = new Set(["electron", "events", "timers", "url"]);

const PRELOAD_DIRECTORY = resolve(import.meta.dirname, "../out/preload");

// Every method of `window.openbot` takes a payload or a listener first.
type BridgeMethod = (payloadOrListener: unknown) => unknown;

interface IpcCall {
  readonly method: "invoke" | "on" | "once";
  readonly channel: string;
}

interface PreloadRun {
  readonly worlds: ReadonlyMap<string, unknown>;
  readonly calls: IpcCall[];
}

const logger = createOpenBotLogger("verify-preload-bundle");
const failures: string[] = [];

const main = runPreload("index.cjs");
const expected = expectedMethods();
const exposed = new Map<string, BridgeMethod>();
for (const world of main.worlds.keys()) {
  if (world !== "openbot") failures.push(`index.cjs exposes window.${world}; only window.openbot is allowed.`);
}
if (main.worlds.has("openbot")) collectMethods(main.worlds.get("openbot"), "", exposed);
else failures.push("index.cjs does not expose window.openbot.");
for (const path of exposed.keys()) {
  if (!expected.has(path) && !HAND_WRITTEN_METHODS.includes(path)) {
    failures.push(`window.openbot.${path} is exposed, but no endpoint names it.`);
  }
}
for (const path of [...expected.keys(), ...HAND_WRITTEN_METHODS]) {
  if (!exposed.has(path)) failures.push(`window.openbot.${path} is not exposed.`);
}
for (const [path, channel] of expected) {
  const method = exposed.get(path);
  if (method !== undefined) checkChannel(main, path, method, channel);
}

const teamWebrtc = runPreload("teamWebrtc.cjs");
if (teamWebrtc.worlds.size > 0) {
  failures.push(`teamWebrtc.cjs must expose no world; it exposes: ${[...teamWebrtc.worlds.keys()].join(", ")}.`);
}

if (failures.length > 0) {
  logger.error(["The built preload does not match the IPC contract:", ...failures.map((f) => `  ${f}`)].join("\n"));
  process.exit(1);
}
logger.info(`The built preload exposes ${exposed.size} methods, and each one matches its endpoint.`);

function runPreload(fileName: string): PreloadRun {
  const source = readFileSync(resolve(PRELOAD_DIRECTORY, fileName), "utf8");
  if (/\bimport\s*\(/.test(source)) failures.push(`${fileName} calls import().`);
  for (const [, specifier] of source.matchAll(/\brequire\(([^)]*)\)/g)) {
    const name = /^["']([^"']+)["']$/.exec(specifier ?? "")?.[1];
    if (name === undefined || !SANDBOX_MODULES.has(name)) {
      failures.push(`${fileName} calls require(${specifier}), which a sandboxed preload cannot load.`);
    }
  }

  const worlds = new Map<string, unknown>();
  const calls: IpcCall[] = [];
  // Never settles, so a method's decoder never runs on a value that main did not send.
  const pending = () => new Promise<never>(() => undefined);
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name: string, api: unknown) => worlds.set(name, api),
    },
    ipcRenderer: {
      invoke: (channel: string) => {
        calls.push({ method: "invoke", channel });
        return pending();
      },
      on: (channel: string) => calls.push({ method: "on", channel }),
      once: (channel: string) => calls.push({ method: "once", channel }),
      removeListener: () => undefined,
    },
    webUtils: { getPathForFile: () => "" },
  };
  const window = { addEventListener: () => undefined, postMessage: () => undefined };
  const module = { exports: {} };
  const context = {
    require: (name: string) => {
      if (name === "electron") return electron;
      throw new Error(`The verifier has no fake for ${name}.`);
    },
    module,
    exports: module.exports,
    window,
    console,
    URL,
    crypto,
    structuredClone,
  };
  try {
    runInNewContext(source, context, { filename: fileName });
  } catch (error) {
    failures.push(`${fileName} failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { worlds, calls };
}

// Each method path, such as `agent.listAgents`, with the channel of its endpoint.
function expectedMethods(): Map<string, string> {
  const methods = new Map<string, string>();
  for (const [group, endpoints] of Object.entries(IPC_ENDPOINTS)) {
    const parent = isGroupName(group) ? GROUP_PATHS[group] : null;
    if (parent === null) continue;
    for (const [key, endpoint] of Object.entries(endpoints)) {
      const name = groupApiMethodName(key, endpoint);
      methods.set(parent === "" ? name : `${parent}.${name}`, endpoint.channel);
    }
  }
  return methods;
}

function collectMethods(value: unknown, path: string, into: Map<string, BridgeMethod>): void {
  if (isBridgeMethod(value)) {
    into.set(path, value);
    return;
  }
  if (!isPlainObject(value)) {
    failures.push(`window.openbot${path ? `.${path}` : ""} is not a function or a method group.`);
    return;
  }
  for (const [key, child] of Object.entries(value)) collectMethods(child, path ? `${path}.${key}` : key, into);
}

function checkChannel(run: PreloadRun, path: string, method: BridgeMethod, channel: string) {
  const start = run.calls.length;
  try {
    // A request method takes the listener as its payload, and an event method subscribes it.
    method(() => undefined);
  } catch (error) {
    failures.push(`window.openbot.${path} threw: ${error instanceof Error ? error.message : String(error)}.`);
    return;
  }
  const sent = run.calls.slice(start).map((call) => call.channel);
  if (sent.length !== 1 || sent[0] !== channel) {
    failures.push(`window.openbot.${path} must use ${channel}; it used: ${sent.join(", ") || "no channel"}.`);
  }
}

// The bundle runs in another realm, so its objects have another `Object.prototype`.
function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== null && Object.getPrototypeOf(prototype) === null;
}

function isGroupName(name: string): name is IpcGroupName {
  return Object.hasOwn(IPC_ENDPOINTS, name);
}

function isBridgeMethod(value: unknown): value is BridgeMethod {
  return typeof value === "function";
}
