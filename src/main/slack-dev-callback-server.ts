/**
 * Development only: where a Slack install returns when `bun run dev:slack` runs.
 *
 * A packaged build gets the install back as an `openbot://slack-workspace` link. On a computer that
 * also has OpenBot installed, the operating system sends that link to the installed app, not to the
 * dev app. So the dev app names this loopback listener as the return address, and a development
 * account API sends the browser here. The waiting connect checks `nonce` the same way, so a request
 * this run did not start does nothing.
 */

import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { sourceText } from "@openbot/i18n/source";
import { parseDeepLink } from "./deep-link-router";

export const SLACK_DEV_CALLBACK_PATH = "/slack-workspace";

export interface SlackDevCallbackServer {
  close(): Promise<void>;
}

export async function startSlackDevCallbackServer(
  port: number,
  receive: (nonce: string, grant: string) => Promise<boolean>,
): Promise<SlackDevCallbackServer> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((request, response) => {
    void answer(request.method, request.url, receive).then((received) => {
      response
        .writeHead(received ? 200 : 404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
        .end(received ? sourceText("status.messaging.signInReceived") : sourceText("status.messaging.signInUnknown"));
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function answer(
  method: string | undefined,
  url: string | undefined,
  receive: (nonce: string, grant: string) => Promise<boolean>,
): Promise<boolean> {
  if (method !== "GET" || !url?.startsWith(SLACK_DEV_CALLBACK_PATH)) return false;
  const link = parseDeepLink(`openbot://${url.replace(/^\/+/u, "")}`);
  if (link?.kind !== "slack-workspace") return false;
  return receive(link.nonce, link.grant).catch(() => false);
}
