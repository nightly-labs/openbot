import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import type { AppTextKey } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { LanguageService } from "./language-service";
import { listenLoopback, listenLoopbackExact } from "./listen-loopback";

const logger = createOpenBotLogger("loopback-callback-server");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export interface CallbackAnswer {
  status: number;
  message: Extract<AppTextKey, `error.mcp.redirect${string}`>;
}

export interface LoopbackCallbackServer {
  readonly port: number;
  close: () => Promise<void>;
}

export interface LoopbackCallbackServerOptions {
  paths: readonly string[];
  receive: (url: URL) => CallbackAnswer | Promise<CallbackAnswer>;
  language: Pick<LanguageService, "locale" | "translate">;
  port: { exact: number } | { preferred?: number | undefined };
  noPort: () => Error;
}

export async function startLoopbackCallbackServer(
  options: LoopbackCallbackServerOptions,
): Promise<LoopbackCallbackServer> {
  const sockets = new Set<Socket>();
  const answering = new Set<Socket>();
  const reading = new Set<Socket>();
  let closing = false;
  const server: Server = createServer((request, response) => {
    const socket = request.socket;
    answering.add(socket);
    response.on("close", () => {
      answering.delete(socket);
      if (closing) socket.destroy();
    });
    const send = (answer: CallbackAnswer) =>
      response
        .writeHead(answer.status, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        })
        .end(callbackPage(options.language.locale, options.language.translate(answer.message)));
    const answer = (result: CallbackAnswer | Promise<CallbackAnswer>) => {
      if (!(result instanceof Promise)) return send(result);
      reading.add(socket);
      void result
        .catch((): CallbackAnswer => ({ status: 500, message: "error.mcp.redirectNotSaved" }))
        .then((settled) => {
          reading.delete(socket);
          if (!socket.destroyed) send(settled);
        });
    };
    const checked = checkCallbackRequest(request.method, request.url, request.headers.host, options.paths);
    if (!(checked instanceof URL)) return send(checked);
    if (request.method !== "POST") return answer(options.receive(checked));
    reading.add(socket);
    void readFormBody(request).then((form) => {
      reading.delete(socket);
      if (form === null) {
        logger.warn("A sign-in callback was posted with a body that OpenBot cannot read.", {
          contentType: request.headers["content-type"] ?? null,
        });
        return send({ status: 400, message: "error.mcp.redirectNotSignIn" });
      }
      for (const [name, value] of new URLSearchParams(form)) checked.searchParams.set(name, value);
      answer(options.receive(checked));
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const port =
    "exact" in options.port
      ? await listenLoopbackExact(server, options.noPort, options.port.exact)
      : await listenLoopback(server, options.noPort, options.port.preferred);
  return {
    port,
    close: async () => {
      closing = true;
      for (const socket of sockets) if (!answering.has(socket) || reading.has(socket)) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function checkCallbackRequest(
  method: string | undefined,
  target: string | undefined,
  host: string | undefined,
  paths: readonly string[],
): URL | CallbackAnswer {
  if (!isLoopbackHost(host)) return { status: 403, message: "error.mcp.redirectByName" };
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return { status: 405, message: "error.mcp.redirectNotSignIn" };
  }
  let url: URL;
  try {
    url = new URL(target ?? "/", "http://127.0.0.1");
  } catch {
    return { status: 404, message: "error.mcp.redirectNotSignIn" };
  }
  if (!paths.includes(url.pathname)) return { status: 404, message: "error.mcp.redirectNotSignIn" };
  return url;
}

const FORM_BODY_LIMIT = 16 * 1024;

function readFormBody(request: IncomingMessage): Promise<string | null> {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") {
    request.resume();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= FORM_BODY_LIMIT) chunks.push(chunk);
      else resolve(null);
    });
    request.on("end", () => resolve(size <= FORM_BODY_LIMIT ? Buffer.concat(chunks).toString("utf8") : null));
    request.on("error", () => resolve(null));
    request.on("close", () => resolve(null));
  });
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function callbackPage(locale: string, message: string): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>OpenBot</title></head><body style="font-family:system-ui;padding:2rem"><p>${message}</p></body></html>`;
}
