// @vitest-environment node

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { MODEL_LIST_BODY_LIMIT, probeModels } from "./model-server-probe";
import { createProviderDetection } from "./provider-detection";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

interface Seen {
  path: string | undefined;
  authorization: string | undefined;
  tenant: string | undefined;
}

/** A real server on a free loopback port, so the probe goes through fetch as it does in the app. */
async function serve(reply: (request: IncomingMessage, response: ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    seen.push({
      path: request.url,
      authorization: request.headers.authorization,
      tenant: request.headers["x-tenant"]?.toString(),
    });
    reply(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server has no port.");
  const { port } = address;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, host: `127.0.0.1:${port}`, seen };
}

const modelList = (response: ServerResponse) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({ data: [{ id: "qwen3" }, { id: "qwen3" }, { id: "" }, { name: "x" }, { id: "llama" }] }),
  );
};

describe("probeModels", () => {
  it("lists the models once each and sends the key as a Bearer token", async () => {
    const server = await serve((_request, response) => modelList(response));

    const models = await probeModels(
      { baseUrl: server.baseUrl, apiKey: "sk-probe", headers: [{ name: "X-Tenant", value: "t1" }] },
      2_000,
    );

    expect(models).toEqual([{ id: "qwen3" }, { id: "llama" }]);
    expect(server.seen).toEqual([{ path: "/v1/models", authorization: "Bearer sk-probe", tenant: "t1" }]);
  });

  it("sends no Authorization header without a key", async () => {
    const server = await serve((_request, response) => modelList(response));
    await probeModels({ baseUrl: server.baseUrl, apiKey: null, headers: [] }, 2_000);
    expect(server.seen[0]?.authorization).toBeUndefined();
  });

  it("refuses a redirect and does not follow it with the key", async () => {
    const target = await serve((_request, response) => modelList(response));
    const server = await serve((_request, response) => {
      response.writeHead(302, { location: `${target.baseUrl}/models` });
      response.end();
    });

    await expect(probeModels({ baseUrl: server.baseUrl, apiKey: "sk-probe", headers: [] }, 2_000)).rejects.toThrow(
      server.host,
    );
    expect(target.seen).toEqual([]);
  });

  it("stops at the time limit", async () => {
    const server = await serve(() => {
      // Never answers.
    });
    await expect(probeModels({ baseUrl: server.baseUrl, apiKey: null, headers: [] }, 200)).rejects.toThrow(server.host);
  });

  it("refuses a body over the limit, declared or streamed", async () => {
    const declared = await serve((_request, response) => {
      response.writeHead(200, { "content-length": String(MODEL_LIST_BODY_LIMIT + 1) });
      response.end();
    });
    const streamed = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      const chunk = "x".repeat(64 * 1024);
      for (let sent = 0; sent <= MODEL_LIST_BODY_LIMIT; sent += chunk.length) response.write(chunk);
      response.end();
    });

    for (const server of [declared, streamed]) {
      await expect(probeModels({ baseUrl: server.baseUrl, apiKey: null, headers: [] }, 2_000)).rejects.toThrow(
        server.host,
      );
    }
  });

  it("names the host only, never the path, the query or the key", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(500);
      response.end("sk-probe");
    });
    const message = await probeModels(
      { baseUrl: `${server.baseUrl}/tenant-token?token=query-secret`, apiKey: "sk-probe", headers: [] },
      2_000,
    ).then(
      () => "",
      (caught: unknown) => (caught instanceof Error ? caught.message : ""),
    );

    expect(message).toContain(server.host);
    for (const secret of ["tenant-token", "query-secret", "sk-probe"]) expect(message).not.toContain(secret);
  });
});

describe("discoverModels", () => {
  const saved = (baseUrl: string) => ({
    id: "studio",
    name: "Studio",
    baseUrl,
    apiKey: "sk-saved",
    models: [],
    headers: [{ name: "X-Tenant", value: "saved-tenant" }],
  });
  const detection = (baseUrl: string) =>
    createProviderDetection({
      settings: { get: () => ({ enabled: true, addresses: [], folders: [], hiddenIds: [] }) },
      customProviders: { configs: () => [saved(baseUrl)] },
      customAgents: { configs: () => [] },
      probe: probeModels,
    });

  it("uses the stored key and headers for the saved origin", async () => {
    const server = await serve((_request, response) => modelList(response));
    await detection(server.baseUrl).discoverModels({
      baseUrl: `${server.baseUrl}/`,
      apiKey: null,
      headers: [],
      savedProviderId: "studio",
    });
    expect(server.seen[0]).toMatchObject({ authorization: "Bearer sk-saved", tenant: "saved-tenant" });
  });

  it("never sends the stored key to another origin", async () => {
    const server = await serve((_request, response) => modelList(response));
    await detection("http://127.0.0.1:1/v1").discoverModels({
      baseUrl: server.baseUrl,
      apiKey: null,
      headers: [],
      savedProviderId: "studio",
    });
    expect(server.seen[0]).toMatchObject({ authorization: undefined, tenant: undefined });
  });
});
