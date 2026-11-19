import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { LocalMcpSession } from "./local-mcp-bridge";
import type { ClaudeMcpServer } from "./mcp-provider-shapes";
import { isInheritedProfileValue } from "./mcp-redaction";
import { type StdioMcpRelay, startStdioMcpRelay } from "./mcp-stdio-relay";
import { OPENBOT_DYNAMIC_TOOLS } from "./openbot-tools";
import { providerCall } from "./provider-client-effects";

const EXTENSION = String.raw`export default function (pi) {
  pi.on("tool_result", (event) => {
    if (event.toolName !== "tool_search" || event.isError) return undefined;
    return { content: [...event.content, { type: "text", text: ${JSON.stringify(piToolSearchNote())} }] };
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

function serverName(kind: "external" | "local", name: string): string {
  return `openbot_${createHash("sha256").update(`${kind}:${name}`).digest("hex").slice(0, 8)}`;
}

function piToolSearchNote(): string {
  const openbot = `mcp__${serverName("local", OPENBOT_DYNAMIC_TOOLS.name)}`;
  return `This search loads only the tools of the servers in <mcp_servers>. It never finds OpenBot or browser tools: find them with ${openbot}__tool_search, and run them with ${openbot}__tool_call.`;
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
          name: serverName("external", name),
          config: { ...server, headers: values(server.headers), exposure: "deferred", description: name },
        };
      if (!relay)
        return {
          name: serverName("external", name),
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
        name: serverName("external", name),
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
    name: serverName("local", server.name),
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
