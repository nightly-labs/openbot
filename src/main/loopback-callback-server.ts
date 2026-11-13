/**
 * A loopback listener that takes the callback of a browser sign-in: the MCP grant listener of this
 * computer, and the listener of a sign-in that this computer relays to a joined server.
 *
 * Every refusal that does not depend on the sign-in is here, so each listener makes the same checks:
 * the `Host` header names the loopback address, the method is GET, HEAD or a form POST, and the path
 * is one that the sign-in sent. The page the browser is left on is a fixed catalog message. The code
 * is in the request line or the form, and a page that repeated it would put a credential in the
 * browser's history.
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import type { AppTextKey } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { LanguageService } from "./language-service";
import { listenLoopback, listenLoopbackExact } from "./listen-loopback";

const logger = createOpenBotLogger("loopback-callback-server");

/** The names a request may claim to have reached. Anything else is a page rebinding a name here. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export interface CallbackAnswer {
  status: number;
  /** The catalog key of the page text. */
  message: Extract<AppTextKey, `error.mcp.redirect${string}`>;
}

export interface LoopbackCallbackServer {
  readonly port: number;
  close: () => Promise<void>;
}

export interface LoopbackCallbackServerOptions {
  /** The paths this listener answers. Everything else is a 404, including `/`. */
  paths: readonly string[];
  /**
   * Answers a callback that passed the checks. It is synchronous, so the browser does not wait for
   * the network: the sign-in shows its own end in OpenBot.
   */
  receive: (url: URL) => CallbackAnswer;
  /** Read on each request, so the page uses the language that is set at that time. */
  language: Pick<LanguageService, "locale" | "translate">;
  /** `exact` binds that port or fails; `preferred` tries it first and then takes any free port. */
  port: { exact: number } | { preferred?: number | undefined };
  noPort: () => Error;
}

/** Binds the listener, or fails. A failure is the caller's to handle. */
export async function startLoopbackCallbackServer(
  options: LoopbackCallbackServerOptions,
): Promise<LoopbackCallbackServer> {
  // A browser keeps its connection open after the page is served, and `server.close` waits for
  // every one of them - so shutdown would sit on a socket nobody is using. They are ended by hand.
  // A socket whose page is still on its way is ended when the page is sent: the callback that ends a
  // sign-in can close this listener before the browser has the page that says so.
  // A socket whose form is still arriving has no page to wait for, so it is ended at once.
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
          // The grant is in this request's own URL. A page kept on disk keeps the URL that fetched
          // it, and nothing here is worth a second read anyway.
          "cache-control": "no-store",
        })
        .end(callbackPage(options.language.locale, options.language.translate(answer.message)));
    const checked = checkCallbackRequest(request.method, request.url, request.headers.host, options.paths);
    if (!(checked instanceof URL)) return send(checked);
    if (request.method !== "POST") return send(options.receive(checked));
    // A server that answers with `response_mode=form_post` posts the same fields as a form (#7709).
    // They are added to the query, so the sign-in reads them exactly as it reads a redirect.
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
      send(options.receive(checked));
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

/**
 * The checks of one request, before the sign-in sees it: the parsed URL, or the refusal. Separated
 * from the listener so a test states a request rather than making one.
 */
function checkCallbackRequest(
  method: string | undefined,
  target: string | undefined,
  host: string | undefined,
  paths: readonly string[],
): URL | CallbackAnswer {
  // A page on the web can point a name it controls at 127.0.0.1 and have the browser send a
  // request here believing it is talking to that site. It cannot read the answer, but it can
  // deliver a grant of its own choosing. The `Host` header is what the browser thinks it reached,
  // so a request naming anything but the loopback address is not from a redirect this sent.
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

/** More than a grant needs. A larger body is refused as soon as it passes this size. */
const FORM_BODY_LIMIT = 16 * 1024;

/** The body of a urlencoded form post, or `null` when it is another type, too large, or cut off. */
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
    // A request that ends any other way, such as a closed tab, gets no grant. After `end` this does nothing.
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

/**
 * The whole page. The text is a fixed catalog message, so nothing user-supplied and nothing from the
 * authorization server reaches the markup.
 */
function callbackPage(locale: string, message: string): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>OpenBot</title></head><body style="font-family:system-ui;padding:2rem"><p>${message}</p></body></html>`;
}
