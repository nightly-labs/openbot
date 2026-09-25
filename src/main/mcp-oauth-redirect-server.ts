/**
 * Where an MCP authorization server sends its grant back: a listener on this machine's loopback
 * address, and nothing that leaves it.
 *
 * `openbot://mcp-auth` was the address before this. It is the shorter path - the operating system
 * hands the link straight to the running app - but it is not an address every authorization server
 * accepts. Canva registers a custom scheme without complaint and then refuses it at `/authorize`
 * with `Invalid redirect URI.`, which leaves the user on an error page with nothing to act on. The
 * loopback address is the redirect RFC 8252 tells a native app to use, it is what that server
 * wants, and it is accepted by every other signed-in listing OpenBot ships.
 *
 * So the deep link stays as the fallback for the rare machine where no loopback port can be bound,
 * and this is what a sign-in registers and sends when it is running. The port is whichever one the
 * operating system gives: RFC 8252 says an authorization server must ignore the port of a loopback
 * redirect, and the registration is remade anyway when the stored one names another address.
 *
 * The grant travels no further than this process. The page the browser is left on says only that
 * the window can be closed - the code is in the request line, and a page that repeated it would
 * put a credential in the browser's history.
 */

import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";

/** The one path this listener answers. Everything else is a 404, including `/`. */
const REDIRECT_PATH = "/mcp-auth";

/** The names a request may claim to have reached. Anything else is a page rebinding a name here. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export interface McpOAuthRedirectServer {
  /** The address to register and to send. Stable for as long as this process runs. */
  readonly redirectUrl: string;
  close: () => Promise<void>;
}

export interface McpOAuthRedirectServerOptions {
  /**
   * Hands the grant to the sign-in that is waiting for this `state`, and answers whether one was.
   * A `state` this run did not start is what a forged or replayed request looks like, and it is
   * refused here exactly as the deep link refuses it.
   */
  deliver: (state: string, code: string) => boolean;
}

/**
 * Binds the listener, or fails.
 *
 * A failure is the caller's to handle rather than this module's: the sign-in still has the deep
 * link to fall back to, and a redirect address that silently became a different one is worse than
 * a named failure.
 */
export async function startMcpOAuthRedirectServer({
  deliver,
}: McpOAuthRedirectServerOptions): Promise<McpOAuthRedirectServer> {
  // A browser keeps its connection open after the page is served, and `server.close` waits for
  // every one of them - so shutdown would sit on a socket nobody is using. They are ended by hand.
  const sockets = new Set<Socket>();
  const server: Server = createServer((request, response) => {
    const answer = respondTo(request.method, request.url, request.headers.host, deliver);
    response
      .writeHead(answer.status, {
        "content-type": "text/html; charset=utf-8",
        // The grant is in this request's own URL. A page kept on disk keeps the URL that fetched
        // it, and nothing here is worth a second read anyway.
        "cache-control": "no-store",
      })
      .end(answer.body);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const port = await listen(server);
  return {
    redirectUrl: `http://127.0.0.1:${port}${REDIRECT_PATH}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listen(server: Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    // `127.0.0.1` and not `localhost`: a name resolves to whatever the machine says it resolves
    // to, and this must be the loopback interface alone - a listener any other computer can reach
    // is a listener that can be handed a grant.
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("The MCP sign-in listener was given no port."));
        return;
      }
      resolve(address.port);
    });
  });
}

interface Answer {
  status: number;
  body: string;
}

/**
 * What one request gets back. Separated from the listener so a test states a request rather than
 * making one, and so every refusal below is one `return`.
 */
function respondTo(
  method: string | undefined,
  target: string | undefined,
  host: string | undefined,
  deliver: (state: string, code: string) => boolean,
): Answer {
  // A page on the web can point a name it controls at 127.0.0.1 and have the browser send a
  // request here believing it is talking to that site. It cannot read the answer, but it can
  // deliver a grant of its own choosing. The `Host` header is what the browser thinks it reached,
  // so a request naming anything but the loopback address is not from a redirect this sent.
  if (!isLoopbackHost(host)) return { status: 403, body: page("This address is not reachable by name.") };
  if (method !== "GET" && method !== "HEAD") return { status: 405, body: page("This address answers GET only.") };
  let url: URL;
  try {
    url = new URL(target ?? "/", "http://127.0.0.1");
  } catch {
    return { status: 404, body: page("This address is not part of a sign-in.") };
  }
  if (url.pathname !== REDIRECT_PATH) return { status: 404, body: page("This address is not part of a sign-in.") };

  // An authorization server states a refusal here instead of sending a code. The sign-in itself
  // ends on its own deadline, with the words the dialog already has; this page exists so the
  // person reading the browser is not left on a blank one.
  const failure = url.searchParams.get("error");
  if (failure) return { status: 400, body: page("The sign-in was refused. Go back to OpenBot and try again.") };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return { status: 400, body: page("This address is not part of a sign-in.") };
  if (!deliver(state, code)) return { status: 400, body: page("No sign-in is waiting for this. It may have ended.") };
  return { status: 200, body: page("OpenBot is signed in. You can close this window.") };
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
 * The whole page. The text is fixed at every call site above, so nothing user-supplied and nothing
 * from the authorization server reaches the markup.
 */
function page(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OpenBot</title></head><body style="font-family:system-ui;padding:2rem"><p>${message}</p></body></html>`;
}
