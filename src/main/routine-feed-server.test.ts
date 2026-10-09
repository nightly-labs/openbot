// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { RoutineFeedAgentNotFound, RoutineFeedServer } from "./routine-feed-server";

const servers: RoutineFeedServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => Effect.runPromise(server.stop())));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Reversible, and the stored text never holds the token. */
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join(""), "utf8"),
  decrypt: (value: Buffer) => [...value.toString("utf8")].reverse().join(""),
};

async function feedPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-routine-feed-"));
  roots.push(root);
  return join(root, "feed.json");
}

function feedServer(path: string): RoutineFeedServer {
  const server = new RoutineFeedServer({
    path,
    cipher,
    document: (agentId) =>
      agentId === "missing" ? Effect.fail(new RoutineFeedAgentNotFound()) : Effect.succeed(`FEED ${agentId ?? "all"}`),
  });
  servers.push(server);
  return server;
}

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function createFeed(server: RoutineFeedServer): Promise<string> {
  const { url } = await Effect.runPromise(server.create());
  if (!url) throw new Error("The feed has no URL.");
  return url;
}

describe("RoutineFeedServer", () => {
  it("serves the feed only for the current token, with an optional agent filter", async () => {
    const url = await createFeed(feedServer(await feedPath()));
    const { port } = new URL(url);

    await expect(get(url)).resolves.toEqual({ status: 200, body: "FEED all" });
    await expect(get(`${url}?agent=agent-1`)).resolves.toEqual({ status: 200, body: "FEED agent-1" });
    await expect(get(`${url}?agent=missing`)).resolves.toMatchObject({ status: 404 });
    await expect(get(`http://127.0.0.1:${port}/routines/wrong-token.ics`)).resolves.toMatchObject({ status: 404 });
  });

  it("refuses a request from a web page or a foreign host before it reads the token", async () => {
    const url = await createFeed(feedServer(await feedPath()));

    await expect(get(url, { origin: "https://example.com" })).resolves.toMatchObject({ status: 403 });
    await expect(get(url, { host: "attacker.example" })).resolves.toMatchObject({ status: 403 });
  });

  it("revokes the old URL on regenerate and keeps the new URL across a restart", async () => {
    const path = await feedPath();
    const server = feedServer(path);
    const old = await createFeed(server);
    const current = await createFeed(server);

    expect(current).not.toBe(old);
    expect(new URL(current).port).toBe(new URL(old).port);
    await expect(get(old)).resolves.toMatchObject({ status: 404 });

    await Effect.runPromise(server.stop());
    const restarted = feedServer(path);
    await Effect.runPromise(restarted.start());
    await expect(Effect.runPromise(restarted.status())).resolves.toEqual({ url: current });
    await expect(get(current)).resolves.toMatchObject({ status: 200 });
  });

  it("keeps the token out of the file and the logs, and forgets it when turned off", async () => {
    const path = await feedPath();
    const server = feedServer(path);
    const url = await createFeed(server);
    const token = /\/routines\/(.+)\.ics$/.exec(url)?.[1] ?? "";

    expect(await readFile(path, "utf8")).not.toContain(token);
    expect(redactText(`GET ${url}`)).not.toContain(token);

    await expect(Effect.runPromise(server.remove())).resolves.toEqual({ url: null });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(get(url)).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});
