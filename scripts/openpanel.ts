import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { loadSharedDevelopmentEnvironment } from "./development-environment";

// Calls the OpenPanel MCP server for the openpanel skill. The token is OPENPANEL_MCP_TOKEN, the same
// root client in apps/auth-api/.env.dev and apps/auth-api/.env.production. It reads analytics and
// changes dashboards and reports. It is decrypted for each run and is never written to disk or output.
//
//   bun scripts/openpanel.ts tools [name]
//   bun scripts/openpanel.ts call <tool> ['<json arguments>']

const SERVER_URL = "https://analytics.openbot.run/api/mcp";

const McpParams = Schema.Record(Schema.String, Schema.Unknown);
type McpParams = typeof McpParams.Type;
const decodeArguments = Schema.decodeUnknownSync(Schema.fromJsonString(McpParams));
const decodeReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      result: Schema.optional(Schema.Unknown),
      error: Schema.optional(Schema.Struct({ message: Schema.String })),
    }),
  ),
);
const decodeTools = Schema.decodeUnknownSync(
  Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String), inputSchema: Schema.Unknown }),
    ),
  }),
);
const decodeToolResult = Schema.decodeUnknownSync(
  Schema.Struct({
    content: Schema.optional(
      Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
    ),
    isError: Schema.optional(Schema.Boolean),
  }),
);

// The server is stateless: each request stands alone, so the script sends no initialize request.
// This keeps each command to one request of the 60 per minute that the server allows.
function createClient(token: string) {
  return async function request<A>(method: string, params: McpParams, decode: (result: unknown) => A): Promise<A> {
    const response = await fetch(SERVER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenPanel returned HTTP ${response.status} for ${method}. ${text.slice(0, 500)}`);
    }
    const reply = decodeReply(text);
    if (reply.error) throw new Error(`${method} failed. ${reply.error.message}`);
    return decode(reply.result);
  };
}

if (import.meta.main) {
  const [command, name, json] = process.argv.slice(2);
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const token =
    process.env.OPENPANEL_MCP_TOKEN || (await loadSharedDevelopmentEnvironment(projectRoot)).OPENPANEL_MCP_TOKEN;
  if (!token) {
    throw new Error("OPENPANEL_MCP_TOKEN is not available. See .agents/skills/openpanel/SKILL.md to load the key.");
  }
  const request = createClient(token);
  if (command === "tools") {
    const { tools } = await request("tools/list", {}, decodeTools);
    if (name) {
      process.stdout.write(`${JSON.stringify(tools.find((tool) => tool.name === name) ?? null, null, 2)}\n`);
    } else {
      for (const tool of tools) process.stdout.write(`${tool.name}: ${tool.description?.split("\n")[0] ?? ""}\n`);
    }
  } else if (command === "call" && name) {
    const result = await request(
      "tools/call",
      { name, arguments: json ? decodeArguments(json) : {} },
      decodeToolResult,
    );
    for (const part of result.content ?? []) process.stdout.write(`${part.text ?? JSON.stringify(part)}\n`);
    if (result.isError) process.exitCode = 1;
  } else {
    throw new Error("Usage: bun scripts/openpanel.ts tools [name] | call <tool> ['<json arguments>']");
  }
}
