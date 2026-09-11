// The user's own MCP servers, translated into the three shapes a provider session accepts.
//
// The store holds one record. Codex wants a config overlay, Claude wants a named object, and ACP
// (Grok and OpenCode) wants an array of typed servers. This module is the one place that mapping
// lives, so a new transport is not three copies of the same fields.

export interface CustomMcpEnvVar {
  readonly name: string;
  readonly value: string;
}

export interface CustomMcpHeader {
  readonly name: string;
  readonly value: string;
}

export type CustomMcpConfig =
  | {
      readonly id: string;
      readonly name: string;
      readonly transport: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: readonly CustomMcpEnvVar[];
    }
  | {
      readonly id: string;
      readonly name: string;
      readonly transport: "http";
      readonly url: string;
      readonly headers: readonly CustomMcpHeader[];
    };

export type CustomMcpSource = () => readonly CustomMcpConfig[];

export type AcpMcpServer =
  | {
      type: "stdio";
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
    }
  | {
      type: "http";
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    };

/** Claude's SDK: a stdio server is a command object; an HTTP server names its type. */
export type ClaudeMcpServer =
  | {
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      type: "http";
      url: string;
      headers: Record<string, string>;
    };

/** Codex `config.mcp_servers` overlay. */
export type CodexMcpServer =
  | {
      command: string;
      args: string[];
      env: Record<string, string>;
      enabled: true;
    }
  | {
      url: string;
      http_headers: Record<string, string>;
      enabled: true;
    };

export function toAcpMcpServers(servers: readonly CustomMcpConfig[]): AcpMcpServer[] {
  return servers.map((server) =>
    server.transport === "stdio"
      ? {
          type: "stdio",
          name: server.id,
          command: server.command,
          args: [...server.args],
          env: server.env.map((entry) => ({ name: entry.name, value: entry.value })),
        }
      : {
          type: "http",
          name: server.id,
          url: server.url,
          headers: server.headers.map((entry) => ({ name: entry.name, value: entry.value })),
        },
  );
}

export function toClaudeMcpServers(servers: readonly CustomMcpConfig[]): Record<string, ClaudeMcpServer> {
  return Object.fromEntries(
    servers.map((server) => [
      server.id,
      server.transport === "stdio"
        ? {
            command: server.command,
            args: [...server.args],
            env: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
          }
        : {
            type: "http" as const,
            url: server.url,
            headers: Object.fromEntries(server.headers.map((entry) => [entry.name, entry.value])),
          },
    ]),
  );
}

export function toCodexMcpServers(servers: readonly CustomMcpConfig[]): Record<string, CodexMcpServer> {
  return Object.fromEntries(
    servers.map((server) => [
      server.id,
      server.transport === "stdio"
        ? {
            command: server.command,
            args: [...server.args],
            env: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
            enabled: true as const,
          }
        : {
            url: server.url,
            http_headers: Object.fromEntries(server.headers.map((entry) => [entry.name, entry.value])),
            enabled: true as const,
          },
    ]),
  );
}
