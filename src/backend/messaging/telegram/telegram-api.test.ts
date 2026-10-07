// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TelegramWebApi } from "./telegram-api";

const TOKEN = "123456:ABC-DEF-GHI-TEST-TOKEN";
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

describe("TelegramWebApi.call", () => {
  it("calls the method with JSON payload and returns result", async () => {
    let requestedPath = "";
    const origin = await listen(async (req, res) => {
      requestedPath = req.url ?? "";
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: { id: 12345, is_bot: true, username: "test_bot" } }));
    });

    const api = new TelegramWebApi({ token: TOKEN, origin });
    const me = await api.getMe();

    expect(requestedPath).toBe(`/bot${TOKEN}/getMe`);
    expect(me.username).toBe("test_bot");
    expect(me.id).toBe(12345);
  });

  it("throws invalid_token on 401 Unauthorized", async () => {
    const origin = await listen((_req, res) => {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }));
    });

    const api = new TelegramWebApi({ token: TOKEN, origin });
    await expect(api.getMe()).rejects.toThrow("invalid_token");
  });
});

describe("TelegramWebApi.download", () => {
  it("never sends token to untrusted origins", async () => {
    const foreign = await listen((_req, res) => {
      res.end("foreign content");
    });
    const root = await mkdtemp(join(tmpdir(), "openbot-tg-download-"));
    roots.push(root);

    const api = new TelegramWebApi({ token: TOKEN });
    await expect(api.download(`${foreign}/file`, join(root, "file.txt"), 1024)).rejects.toThrow("untrusted_file_url");
  });

  it("downloads file successfully from valid Telegram file URL", async () => {
    const origin = await listen((req, res) => {
      if (req.url === `/file/bot${TOKEN}/documents/test.txt`) {
        res.end("hello telegram file");
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const root = await mkdtemp(join(tmpdir(), "openbot-tg-download-"));
    roots.push(root);

    const api = new TelegramWebApi({ token: TOKEN, origin });
    const targetPath = join(root, "downloaded.txt");
    await api.download(`${origin}/file/bot${TOKEN}/documents/test.txt`, targetPath, 1024);

    const content = await readFile(targetPath, "utf8");
    expect(content).toBe("hello telegram file");
  });
});
