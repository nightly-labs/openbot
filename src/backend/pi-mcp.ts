import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { LocalMcpSession } from "./local-mcp-bridge";
import type { ClaudeMcpServer } from "./mcp-provider-shapes";
import { providerCall } from "./provider-client-effects";

// Pi owns MCP framing, reconnection, cancellation and tool registration. This extension only
// adds the servers for this process. Credentials are not written to the extension file. Pi runs
// the extension again when it switches sessions, so the list stays in a process slot for those runs.
const EXTENSION = `export default function (pi) {
  const slot = Symbol.for("openbot.pi.mcpServers");
  globalThis[slot] ??= JSON.parse(process.env.OPENBOT_PI_MCP_SERVERS || "[]");
  delete process.env.OPENBOT_PI_MCP_SERVERS;
  for (const server of globalThis[slot]) pi.registerMcpServer(server.name, server.config);
}
`;

export interface PiMcpExtension {
  path: string;
  environment: Record<string, string>;
  secrets: string[];
  close: () => Effect.Effect<void, import("./provider-client-effects").ProviderClientOperationError>;
}

/** Owns one temporary, credential-free extension. Pi's own files are never changed. */
export const createPiMcpExtension = Effect.fn("PiMcp.createExtension")(function* (
  servers: Record<string, ClaudeMcpServer>,
  local: LocalMcpSession,
  directory?: string,
) {
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, "mcp.mjs");
  const environment: Record<string, string> = {};
  const secrets: string[] = [];
  // Pi keeps the tool names in the session that OpenBot resumes, so a name must not change when
  // OpenBot restarts: the model calls the old names, and Pi does not find them (#3343). The name
  // comes from the server's own name, not its position, which changes when a server is added or
  // removed. Pi replaces a tool name longer than 64 characters with a hash, and the model then cannot
  // find tools such as tool_search by name. Eight hex characters keep the names short.
  const serverName = (kind: "external" | "local", name: string) =>
    `openbot_${createHash("sha256").update(`${kind}:${name}`).digest("hex").slice(0, 8)}`;
  const values = (pairs: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => {
        if (value === "") return [key, ""];
        const variable = `OPENBOT_PI_MCP_VALUE_${secrets.length}`;
        secrets.push(value);
        environment[variable] = value;
        // Pi expands one environment reference. A literal beginning with ! must never become a
        // configuration shell command, and literal ${...} must not read another environment value.
        return [key, `\${${variable}}`];
      }),
    );
  const entries = Object.entries(servers).map(([name, server]) => ({
    name: serverName("external", name),
    config:
      server.type === "http"
        ? { ...server, headers: values(server.headers), exposure: "direct" }
        : { ...server, env: values(server.env), exposure: "direct" },
  }));
  const bridge = local.servers.map((server) => ({
    name: serverName("local", server.name),
    config: {
      url: server.url,
      headers: values(Object.fromEntries(server.headers.map(({ name, value }) => [name, value]))),
      exposure: "direct",
    },
  }));
  environment.OPENBOT_PI_MCP_SERVERS = JSON.stringify([...entries, ...bridge]);
  yield* providerCall(() => writeFile(path, EXTENSION, { mode: 0o600 })).pipe(
    Effect.onError(() => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie)),
  );
  return {
    path,
    environment,
    secrets,
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
