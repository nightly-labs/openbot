// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SlackWebApi } from "./slack-web-api";

const TOKEN = "xoxb-1111-2222-downloadtoken";
const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server has no port.");
  return `http://127.0.0.1:${address.port}`;
}

describe("SlackWebApi.download", () => {
  it("never sends the token to another host, also after a redirect", async () => {
    const seen: IncomingHttpHeaders[] = [];
    const foreign = await listen((request, response) => {
      seen.push(request.headers);
      response.end("stolen");
    });
    const slack = await listen((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", `${foreign}/file`);
      response.end();
    });
    const root = await mkdtemp(join(tmpdir(), "openbot-slack-download-"));
    roots.push(root);
    const api = new SlackWebApi({ token: TOKEN, origin: slack });

    await expect(api.download(`${foreign}/file`, join(root, "direct"), 1024)).rejects.toThrow("untrusted_file_url");
    await expect(api.download(`${slack}/file`, join(root, "redirected"), 1024)).rejects.toThrow("untrusted_file_url");
    expect(seen).toEqual([]);
  });

  it("stops a file at its size limit and leaves nothing behind", async () => {
    const slack = await listen((_request, response) => response.end(Buffer.alloc(4096)));
    const root = await mkdtemp(join(tmpdir(), "openbot-slack-download-"));
    roots.push(root);
    const api = new SlackWebApi({ token: TOKEN, origin: slack });
    const destination = join(root, "big");

    await expect(api.download(`${slack}/file`, destination, 1024)).rejects.toThrow("too_large");
    await expect(stat(destination)).rejects.toThrow();

    await api.download(`${slack}/file`, destination, 8192);
    expect((await readFile(destination)).byteLength).toBe(4096);
  });
});
