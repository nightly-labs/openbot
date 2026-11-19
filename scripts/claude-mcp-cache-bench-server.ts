// A stdio MCP server for `claude-mcp-cache-bench.ts`. It answers `initialize` only after the delay in
// its first argument (milliseconds), as a slow user MCP server does, and lists ten tools with
// mid-size schemas. Their tool calls are not used.
import { createInterface } from "node:readline";
import { Schema } from "effect";

const decodeRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
      method: Schema.String,
      params: Schema.optional(Schema.Struct({ protocolVersion: Schema.optional(Schema.String) })),
    }),
  ),
);

const delayMs = Number(process.argv[2] ?? "3000");

const tools = Array.from({ length: 10 }, (_, index) => ({
  name: `lookup_record_${index + 1}`,
  description:
    `Looks up record set ${index + 1} in the bench catalog. Give the record key, the fields to return, ` +
    "the sort order and the page. The result lists the matching records with their fields, the total " +
    "count and the next page token. Use it only when the user asks for catalog records.",
  inputSchema: {
    type: "object",
    properties: {
      key: { type: "string", description: "The record key, such as an order number or a customer ID." },
      fields: {
        type: "array",
        items: { type: "string", enum: ["name", "status", "owner", "created", "updated", "total", "notes"] },
        description: "The fields to return. All fields when empty.",
      },
      sort: { type: "string", enum: ["created", "updated", "total"], description: "The sort field." },
      descending: { type: "boolean", description: "Sort from the largest value." },
      pageToken: { type: "string", description: "The next page token of a previous result." },
      pageSize: { type: "integer", minimum: 1, maximum: 100, description: "Records in one page." },
    },
    required: ["key"],
  },
}));

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const request = decodeRequest(line);
  if (request.id === undefined) continue;
  const method = request.method;
  if (method === "initialize") {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "bench-catalog", version: "1.0.0" },
      },
    });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools } });
  } else if (method === "tools/call") {
    send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "No records." }] } });
  } else {
    send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
}
