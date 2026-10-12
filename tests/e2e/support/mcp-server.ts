import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { z } from "zod";

const messageSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.json()).default({}),
});

function answer(input: unknown, record: (value: string) => void) {
  const message = messageSchema.parse(input);
  if (message.id === undefined) return null;
  let result: z.infer<ReturnType<typeof z.json>>;
  switch (message.method) {
    case "initialize":
      result = {
        protocolVersion: z.string().parse(message.params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: { name: "release-mcp", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = {
        tools: [
          {
            name: "record",
            inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
          },
        ],
      };
      break;
    case "tools/call": {
      const params = z
        .object({ name: z.literal("record"), arguments: z.object({ value: z.string() }) })
        .parse(message.params);
      record(params.arguments.value);
      result = { content: [{ type: "text", text: `MCP recorded: ${params.arguments.value}` }] };
      break;
    }
    default:
      return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown test method" } };
  }
  return { jsonrpc: "2.0", id: message.id, result };
}

export async function startMcpServer(token: string) {
  const receipts: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers["x-e2e-token"] !== token) {
        response.writeHead(403).end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const result = answer(JSON.parse(body), (value) => receipts.push(value));
      if (result === null) response.writeHead(202).end();
      else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    })().catch(() => response.writeHead(400).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const port = z.object({ port: z.number() }).parse(server.address()).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    receipts,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

if (process.argv.includes("--stdio")) {
  const receipt = process.env.OPENBOT_E2E_MCP_RECEIPT;
  if (!receipt) throw new Error("A private receipt path is required.");
  createInterface({ input: process.stdin }).on("line", (line) => {
    const result = answer(JSON.parse(line), (value) => appendFileSync(receipt, `${value}\n`));
    if (result !== null) process.stdout.write(`${JSON.stringify(result)}\n`);
  });
}
