import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPUTER_USE_MCP_SERVER_NAME } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { LocalMcpSession } from "./local-mcp-bridge";
import type { ClaudeMcpServer } from "./mcp-provider-shapes";
import { isInheritedProfileValue } from "./mcp-redaction";
import { type StdioMcpRelay, startStdioMcpRelay } from "./mcp-stdio-relay";
import { OPENBOT_DYNAMIC_TOOLS } from "./openbot-tools";
import { COMPUTER_USE_GUIDE_URI, piMcpServerName } from "./pi-mcp-names";
import { providerCall } from "./provider-client-effects";

const PI_EMPTY_TOOL_SEARCH_NOTE =
  "This search does not show tools that an earlier search loaded. Those tools stay loaded: call them by their names. When no search loaded the tool that you need, search again with other words.";

const EXTENSION = String.raw`export default function (pi) {
  pi.on("tool_result", (event) => {
    if (event.toolName !== "tool_search" || event.isError) return undefined;
    const empty = event.content.some((part) => part.type === "text" && part.text?.includes("No matching tools found"));
    const note = empty ? ${JSON.stringify(`${PI_EMPTY_TOOL_SEARCH_NOTE} ${piToolSearchNote()}`)} : ${JSON.stringify(piToolSearchNote())};
    return { content: [...event.content, { type: "text", text: note }] };
  });
  pi.on("tool_call", (event) => {
    const path = event.toolName === "read" && typeof event.input?.path === "string" ? event.input.path : "";
    if (!/^@?skill:\/\//iu.test(path)) return undefined;
    return { block: true, reason: path.replace(/^@/u, "") + ${JSON.stringify(piSkillReadNote())} };
  });
  const slot = Symbol.for("openbot.pi.mcpServers");
  globalThis[slot] ??= JSON.parse(process.env.OPENBOT_PI_MCP_SERVERS || "[]");
  delete process.env.OPENBOT_PI_MCP_SERVERS;
  for (const server of globalThis[slot]) pi.registerMcpServer(server.name, server.config);
  const workspace = Symbol.for("openbot.pi.workspace");
  pi.on("project_trust", (event) => {
    globalThis[workspace] ??= event.cwd;
    return { trusted: event.cwd === globalThis[workspace] ? "yes" : "undecided" };
  });
  const piDocs = (message) =>
    message.role === "system" && message.sections?.docs?.startsWith?.("<docs>\nPi documentation (read only when ");
  pi.on("context_with_system", (event) => {
    if (!event.messages.some(piDocs)) return undefined;
    const messages = event.messages.flatMap((message, index) => {
      if (!piDocs(message)) return [message];
      const { docs, ...sections } = message.sections;
      const empty = Object.keys(sections).length === 0 && !message.content?.length && !message.toolsAdded && !message.toolsRemoved;
      return index > 0 && empty ? [] : [{ ...message, sections }];
    });
    return { messages };
  });
}
`;

const PI_SEARCH_ONLY_OPENBOT_TOOLS = ["request_api_key", "suggest_marketplace_app", "show_setting"] as const;

function piToolSearchNote(): string {
  const openbot = `mcp__${piMcpServerName("local", OPENBOT_DYNAMIC_TOOLS.name)}`;
  return `This search loads only the tools of the servers in <mcp_servers>. It never finds OpenBot or browser tools: find them with ${openbot}__tool_search, and run them with ${openbot}__tool_call.`;
}

function piSkillReadNote(): string {
  return ` is an MCP resource, not a file, so read cannot open it. Load read_mcp_resource with tool_search, then call it with this uri and the server that lists it. The Computer Use guide ${COMPUTER_USE_GUIDE_URI} is on server ${piMcpServerName("external", COMPUTER_USE_MCP_SERVER_NAME)}.`;
}

const PI_MCP_ATTENTION = "MCP servers need attention:";
const PI_MCP_ATTENTION_LINE = /^\s+(\S+): (?:failed(?:: (.*))?|(needs sign-in))$/u;

export interface PiMcpStartFailure {
  name: string;
  status: "failed";
  error: string;
  failureReason?: "reauthenticationRequired";
}

export function piMcpServerKeys(servers: Readonly<Record<string, ClaudeMcpServer>>): ReadonlyMap<string, string> {
  return new Map(Object.keys(servers).map((name) => [piMcpServerName("external", name), name]));
}

export function piMcpStartFailures(message: string, keys: ReadonlyMap<string, string>): PiMcpStartFailure[] {
  if (!message.startsWith(PI_MCP_ATTENTION)) return [];
  return message.split("\n").flatMap((line): PiMcpStartFailure[] => {
    const match = PI_MCP_ATTENTION_LINE.exec(line);
    const name = match?.[1] ? keys.get(match[1]) : undefined;
    if (!match || !name) return [];
    if (match[3]) return [{ name, status: "failed", error: "", failureReason: "reauthenticationRequired" }];
    return [{ name, status: "failed", error: match[2] ?? "" }];
  });
}

export interface PiMcpExtension {
  path: string;
  environment: Record<string, string>;
  secrets: string[];
  close: () => Effect.Effect<void, import("./provider-client-effects").ProviderClientOperationError>;
}

export interface PiStdioRelayOptions {
  environment: Record<string, string>;
  cwd: string;
}

export const createPiMcpExtension = Effect.fn("PiMcp.createExtension")(function* (
  servers: Record<string, ClaudeMcpServer>,
  local: LocalMcpSession,
  directory?: string,
  relay?: PiStdioRelayOptions,
) {
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, "mcp.mjs");
  const environment: Record<string, string> = {};
  const secrets: string[] = [];
  let count = 0;
  const values = (pairs: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => {
        if (value === "") return [key, ""];
        const variable = `OPENBOT_PI_MCP_VALUE_${count++}`;
        if (!isInheritedProfileValue(key, value)) secrets.push(value);
        environment[variable] = value;
        return [key, `\${${variable}}`];
      }),
    );
  const relays: StdioMcpRelay[] = [];
  const closeRelays = Effect.suspend(() => Effect.forEach(relays, (started) => started.close(), { discard: true }));
  const entries = yield* Effect.forEach(Object.entries(servers), ([name, server]) =>
    Effect.gen(function* () {
      if (server.type === "http")
        return {
          name: piMcpServerName("external", name),
          config: { ...server, headers: values(server.headers), exposure: "deferred", description: name },
        };
      if (!relay)
        return {
          name: piMcpServerName("external", name),
          config: { ...server, env: values(server.env), exposure: "deferred", description: name },
        };
      const started = yield* startStdioMcpRelay({
        command: server.command,
        args: server.args,
        env: { ...relay.environment, ...server.env },
        cwd: server.cwd ?? relay.cwd,
      });
      relays.push(started);
      return {
        name: piMcpServerName("external", name),
        config: {
          type: "http",
          url: started.url,
          headers: values({ Authorization: `Bearer ${started.token}` }),
          exposure: "deferred",
          description: name,
        },
      };
    }),
  ).pipe(Effect.onError(() => closeRelays.pipe(Effect.orDie)));
  const bridge = local.servers.map((server) => ({
    name: piMcpServerName("local", server.name),
    config: {
      url: server.url,
      headers: values(Object.fromEntries(server.headers.map(({ name, value }) => [name, value]))),
      exposure: "direct",
      ...(server.name === OPENBOT_DYNAMIC_TOOLS.name
        ? { toolExposure: Object.fromEntries(PI_SEARCH_ONLY_OPENBOT_TOOLS.map((tool) => [tool, "hidden"])) }
        : {}),
    },
  }));
  environment.OPENBOT_PI_MCP_SERVERS = JSON.stringify([...entries, ...bridge]);
  yield* providerCall(() => writeFile(path, EXTENSION, { mode: 0o600 })).pipe(
    Effect.onError(() =>
      Effect.andThen(
        closeRelays,
        providerCall(() => rm(folder, { recursive: true, force: true })),
      ).pipe(Effect.orDie),
    ),
  );
  return {
    path,
    environment,
    secrets,
    close: () =>
      Effect.andThen(
        closeRelays,
        providerCall(() => rm(folder, { recursive: true, force: true })),
      ),
  } satisfies PiMcpExtension;
});
