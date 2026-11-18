// Starts the real remote viewer proxy on loopback, with a stand-in server connection, and checks its
// limits: each joined server has its own path secret, and the viewer page reaches only the
// remote-screen routes of its server. A host's viewer script runs on the origin of this proxy, so
// without these limits it could send requests to another joined server, or to other Team API routes,
// with this user's session.
// Run: `bun run test:remote-viewer-proxy`. Writes .openbot-build/remote-viewer-proxy-e2e/report.json.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import { RemoteViewerProxy } from "../src/main/remote-viewer-proxy";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/remote-viewer-proxy-e2e");
const SESSION = "session-1";
const VIEWER = TEAM_API_ROUTES.remoteScreen.viewer(SESSION);

// The server connection sends no desktop data in this run.
const transport = Object.assign(new EventEmitter(), { sendDesktop: () => Effect.void });
const fetched: { serverId: string; path: string }[] = [];
const proxy = new RemoteViewerProxy({
  transport,
  fetchResource: (serverId, path) =>
    Effect.sync(() => {
      fetched.push({ serverId, path });
      return new Response(`<script src="${TEAM_API_ROUTES.remoteScreen.prefix}/app.js"></script>`, {
        headers: { "content-type": "text/html" },
      });
    }),
});

interface Reply {
  status: number;
  body: string;
}

function send(url: URL): Promise<Reply> {
  return new Promise((done, fail) => {
    const call = request(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => done({ status: response.statusCode ?? 0, body }));
    });
    call.on("error", fail);
    call.end();
  });
}

/** The status of a WebSocket upgrade, read from the raw socket: the proxy answers a refused one with a bare 404. */
function upgrade(url: URL): Promise<number> {
  return new Promise((done, fail) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(
        `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\n\r\n",
      );
    });
    let head = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      head += chunk;
      const status = /^HTTP\/1\.1 (\d{3})/u.exec(head)?.[1];
      if (status === undefined) return;
      socket.destroy();
      done(Number(status));
    });
    socket.on("error", fail);
  });
}

const checks: { name: string; ok: boolean; detail: unknown }[] = [];
function check(name: string, ok: boolean, detail: unknown): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? "ok" : "not ok"} ${name}\n`);
}

try {
  const urlA = new URL(await Effect.runPromise(proxy.viewerUrl("server-a", VIEWER)));
  const urlB = new URL(await Effect.runPromise(proxy.viewerUrl("server-b", VIEWER)));
  const [, tokenA] = urlA.pathname.split("/");
  const [, tokenB] = urlB.pathname.split("/");
  const at = (token: string | undefined, serverId: string, path: string) =>
    new URL(`/${token}/${serverId}${path}`, urlA.origin);

  const page = await send(urlA);
  check(
    "the viewer page of a server loads, and its remote-screen paths hold that server's secret",
    page.status === 200 &&
      page.body.includes(`/${tokenA}/server-a${TEAM_API_ROUTES.remoteScreen.prefix}/app.js`) &&
      fetched.at(-1)?.serverId === "server-a",
    { status: page.status, body: page.body },
  );

  check("each server has its own path secret", typeof tokenA === "string" && tokenA !== tokenB, {
    sameSecret: tokenA === tokenB,
  });

  const fetchesBefore = fetched.length;
  const crossed = await send(at(tokenA, "server-b", VIEWER));
  const noSecret = await send(new URL(`/server-a${VIEWER}`, urlA.origin));
  const wrongSecret = await send(at("0".repeat(32), "server-a", VIEWER));
  const otherRoute = await send(at(tokenA, "server-a", TEAM_API_ROUTES.compatibility));
  check(
    "a path with the secret of another server, with no secret, with a wrong secret, or to a route that is not remote-screen gets 404 and reaches no server",
    [crossed, noSecret, wrongSecret, otherRoute].every((reply) => reply.status === 404) &&
      fetched.length === fetchesBefore,
    {
      crossed: crossed.status,
      noSecret: noSecret.status,
      wrongSecret: wrongSecret.status,
      otherRoute: otherRoute.status,
    },
  );

  const tunnel = await upgrade(at(tokenA, "server-a", TEAM_API_ROUTES.compatibility));
  const crossedTunnel = await upgrade(
    at(tokenB, "server-a", `${TEAM_API_ROUTES.remoteScreen.sessions}/${SESSION}/stream`),
  );
  check(
    "a WebSocket to a route that is not a stream, or with the secret of another server, gets 404",
    tunnel === 404 && crossedTunnel === 404,
    { tunnel, crossedTunnel },
  );
} finally {
  await Effect.runPromise(proxy.stop());
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ checks }, null, 2)}\n`);
}

assert.ok(checks.length > 0 && checks.every((entry) => entry.ok), "A remote viewer proxy check failed.");
process.stdout.write(`remote-viewer-proxy-e2e: ${checks.length} checks passed\n`);
