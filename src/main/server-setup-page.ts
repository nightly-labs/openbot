/**
 * The setup page of a self-hosted server in a container, such as the Umbrel app (docs/umbrel.md). A
 * container has no terminal that a user of an app store can open with ease, so this page signs the
 * server in with the email code, as `openbot login` does, and shows its status. The page is the
 * `server-setup` entry of the renderer build: the sign-in screen of the app, `AccountLogin`.
 *
 * The page listens on a TCP port of the container, which publishes no port. Only the network of the
 * container reaches it: on Umbrel, the app proxy, which asks for the Umbrel login first. Other programs
 * on that network can reach the port too, so the page answers only the requests of
 * `ServerSetupAction`: status, the retry of the account and the email-code sign-in, which a server
 * with a session refuses. It has no
 * sign-out, claim, rename or Mobile Connect code. It never sends the session token, the code or the
 * challenge of another request back. It serves only its page and the files in `assets/`.
 *
 * Each `/api/` request must have the header `x-openbot-setup: 1`. A page of another site cannot send
 * that header without a CORS preflight, which this listener refuses, so it cannot submit a sign-in.
 */

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { join } from "node:path";
import { SERVER_SETUP_HEADER, SERVER_SETUP_ROUTES } from "@openbot/contracts/server-setup";
import { Effect } from "effect";
import { runCauseEffect } from "../backend/effect-boundary";
import { applicationContentType } from "./application-content-type";
import { readBodyWithin } from "./http-body";
import { type RemoteWorkflowError, remoteCall } from "./remote-service-effects";
import type { ServerModeAnswer, ServerSetupAction } from "./server-mode";

const MAX_BODY_BYTES = 4096;
const PAGE_FILE = "server-setup.html";
/** A file name of the build in `assets/`. No directory, no `..`, no query. */
const ASSET_PATH = /^\/assets\/([\w-]+(?:\.[\w-]+)*\.[a-z0-9]+)$/u;

const API_ROUTES: Record<string, ServerSetupAction> = {
  [`GET ${SERVER_SETUP_ROUTES.status}`]: "status",
  [`POST ${SERVER_SETUP_ROUTES.loginStart}`]: "login_start",
  [`POST ${SERVER_SETUP_ROUTES.loginVerify}`]: "login_verify",
  [`POST ${SERVER_SETUP_ROUTES.retry}`]: "retry",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** As the policy of the app window (content-security-policy.ts), with no outside source. */
const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export interface ServerSetupPageOptions {
  port: number;
  /** The address to bind. A container binds all of its addresses; a test binds the loopback address. */
  address: string;
  /** The renderer build: `server-setup.html` and its `assets/`. */
  rendererRoot: string;
  request: (action: ServerSetupAction, body: URLSearchParams) => Effect.Effect<ServerModeAnswer, RemoteWorkflowError>;
  onError: (message: string, error: unknown) => void;
}

export class ServerSetupPage {
  readonly #options: ServerSetupPageOptions;
  readonly #sockets = new Set<Socket>();
  #server: Server | null = null;

  constructor(options: ServerSetupPageOptions) {
    this.#options = options;
  }

  readonly listen = Effect.fn("ServerSetupPage.listen")(function* (this: ServerSetupPage) {
    const server = createServer((request, response) => void this.#handle(request, response));
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
    });
    yield* remoteCall(
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(this.#options.port, this.#options.address, () => {
            server.removeListener("error", reject);
            resolve();
          });
        }),
    );
    this.#server = server;
  }).bind(this);

  readonly close = Effect.fn("ServerSetupPage.close")(function* (this: ServerSetupPage) {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    });
  }).bind(this);

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = request.url?.split("?")[0] ?? "";
    if (request.method === "GET" && path === "/") {
      await this.#sendFile(response, PAGE_FILE, {
        "cache-control": "no-store",
        "content-security-policy": PAGE_POLICY,
      });
      return;
    }
    const asset = request.method === "GET" ? ASSET_PATH.exec(path)?.[1] : undefined;
    if (asset) {
      // The build gives each file a name with its hash, so a file never changes.
      await this.#sendFile(response, join("assets", asset), { "cache-control": "public, max-age=31536000, immutable" });
      return;
    }
    const action = API_ROUTES[`${request.method ?? ""} ${path}`];
    if (!action) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    if (!isPageRequest(request)) {
      sendJson(response, 403, { error: "forbidden" });
      return;
    }
    let answer: ServerModeAnswer;
    try {
      const body = await readBody(request);
      answer = body === null ? failure(413, "too_large") : await runCauseEffect(this.#options.request(action, body));
    } catch (error) {
      this.#options.onError("A server setup page request failed.", error);
      // The messages of the account and host services are the ones the app shows. They name no secret.
      answer = failure(400, "failed", error instanceof Error ? error.message : null);
    }
    sendJson(response, answer.status, presentLines(answer.lines));
  }

  async #sendFile(response: ServerResponse, file: string, headers: Record<string, string>): Promise<void> {
    let body: Buffer;
    try {
      body = await readFile(join(this.#options.rendererRoot, file));
    } catch {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    response
      .writeHead(200, { ...SECURITY_HEADERS, ...headers, "content-type": applicationContentType(file) })
      .end(body);
  }
}

/** A same-origin request of the page script, never a form or a page of another site. */
function isPageRequest(request: IncomingMessage): boolean {
  if (request.headers[SERVER_SETUP_HEADER] !== "1") return false;
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") return false;
  if (request.method !== "POST") return true;
  return request.headers["content-type"]?.split(";")[0]?.trim() === "application/x-www-form-urlencoded";
}

async function readBody(request: IncomingMessage): Promise<URLSearchParams | null> {
  const body = await readBodyWithin(request, MAX_BODY_BYTES);
  return body === null ? null : new URLSearchParams(body.toString("utf8"));
}

function failure(status: number, error: string, message: string | null = null): ServerModeAnswer {
  return { status, lines: { error, message } };
}

/** The lines that have a value. Messages stay in English: the page shows them in its language. */
function presentLines(lines: ServerModeAnswer["lines"]): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(lines)) {
    if (value !== null && value !== "") result[key] = value;
  }
  return result;
}

function sendJson(response: ServerResponse, status: number, body: Record<string, string | number>): void {
  response
    .writeHead(status, {
      ...SECURITY_HEADERS,
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    })
    .end(JSON.stringify(body));
}
