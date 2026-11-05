import { randomBytes, timingSafeEqual } from "node:crypto";
import { connect, createServer, isIP, type Server, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { BrowserProxyFailure } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { type BrowserOperationError, browserFailure } from "../browser-effects";

/** A SOCKS5 proxy that needs a user name and a password (RFC 1929). */
export interface SocksUpstream {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** A site that the browser asks for: a DNS name or an IP address, and a port. */
interface RelayTarget {
  host: string;
  port: number;
}

/** The SOCKS5 proxy refused the saved sign-in, or it does not take a sign-in. */
class ProxySignInRefused extends Error {}

/** A connection to a site, and the bytes that came from the site before the relay joined it. */
interface RelayExitConnection {
  stream: Duplex;
  early: Buffer;
}

/**
 * Where the relay sends each connection. It opens a connection to the site, or rejects. An abort
 * stops the attempt: the browser went away or the relay stops.
 */
export type RelayExit = (target: RelayTarget, signal: AbortSignal) => Promise<RelayExitConnection>;

/**
 * An HTTP proxy on 127.0.0.1 that Chromium can sign in to. It sends each request through its exit:
 * a SOCKS5 proxy with the saved sign-in, which Chromium cannot sign in to itself, or the computer of a
 * member. Its own sign-in is random, so other programs on the computer cannot use it.
 */
export interface BrowserProxyRelay {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly username: string;
  readonly password: string;
  /**
   * Why the last connection through the relay failed, or null when it connected. Chromium sees only
   * that the tunnel failed; the relay knows when the proxy refused the sign-in.
   */
  readonly exitFailure: () => BrowserProxyFailure | null;
  /** Stops the relay and closes each connection through it. */
  readonly close: Effect.Effect<void>;
}

const RELAY_USERNAME = "openbot";
/** The request head that a browser sends is much smaller. A larger one is not a browser. */
const HEAD_MAX_BYTES = 64 * 1024;
const HEAD_TIMEOUT_MS = 30_000;
const SOCKS_TIMEOUT_MS = 20_000;
const MAX_CONNECTIONS = 256;
/** Request headers that are for the relay, not for the site. */
const HOP_HEADERS = new Set(["proxy-authorization", "proxy-connection", "connection", "keep-alive"]);

const BAD_GATEWAY = "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const BAD_REQUEST = "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const SIGN_IN_REQUIRED =
  'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="OpenBot"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';

interface RelayRequest {
  target: RelayTarget;
  /** The bytes to send to the site first: nothing for a tunnel, the request head for plain HTTP. */
  head: Buffer;
  tunnel: boolean;
}

function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/u.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : null;
}

/** Reads `host:port` or `[v6]:port`. */
function parseAuthority(text: string, defaultPort: number | null): RelayTarget | null {
  const match = /^(?:\[([0-9a-fA-F:.]+)\]|([^:[\]\s/]+))(?::(\d{1,5}))?$/u.exec(text);
  if (!match) return null;
  const host = match[1] ?? match[2] ?? "";
  const port = match[3] === undefined ? defaultPort : parsePort(match[3]);
  if (host.length === 0 || host.length > 255 || port === null) return null;
  return { host, port };
}

/** Reads the request head that Chromium sends to an HTTP proxy. */
function parseRequest(head: string, expectedAuthorization: Buffer): RelayRequest | "signIn" | null {
  const lines = head.split("\r\n");
  const [method, target, version, ...rest] = (lines[0] ?? "").split(" ");
  if (rest.length > 0 || method === undefined || target === undefined || !/^HTTP\/1\.[01]$/u.test(version ?? ""))
    return null;
  const headers: string[] = [];
  let authorized = false;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) return null;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (name === "proxy-authorization") {
      const given = Buffer.from(line.slice(colon + 1).trim());
      authorized = given.length === expectedAuthorization.length && timingSafeEqual(given, expectedAuthorization);
    }
    if (!HOP_HEADERS.has(name)) headers.push(line);
  }
  if (!authorized) return "signIn";
  if (method === "CONNECT") {
    const authority = parseAuthority(target, null);
    return authority === null ? null : { target: authority, head: Buffer.alloc(0), tunnel: true };
  }
  // A plain http:// request comes in the absolute form. https:// and wss:// always use CONNECT.
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  const authority = parseAuthority(url.host, 80);
  if (authority === null) return null;
  // One request for each connection: the next request can be for a different site.
  const requestHead = [`${method} ${url.pathname}${url.search} ${version}`, ...headers, "Connection: close", "", ""];
  return { target: authority, head: Buffer.from(requestHead.join("\r\n"), "latin1"), tunnel: false };
}

/** The eight 16-bit words of an IPv6 address that `isIP` accepts, also with an IPv4 end. */
function ipv6Words(host: string): number[] | null {
  let text = host.split("%")[0] ?? "";
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(text);
  if (dotted) {
    const [, a = "", b = "", c = "", d = ""] = dotted;
    const word = (high: string, low: string) => ((Number(high) << 8) | Number(low)).toString(16);
    text = `${text.slice(0, dotted.index)}${word(a, b)}:${word(c, d)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) => (part ? part.split(":").map((word) => Number.parseInt(word, 16)) : []);
  const left = parse(halves[0]);
  const right = parse(halves[1]);
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const words = [...left, ...Array<number>(halves.length === 1 ? 0 : missing).fill(0), ...right];
  return words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : null;
}

function socksAddress(host: string): Buffer | null {
  const family = isIP(host);
  if (family === 4) return Buffer.from([0x01, ...host.split(".").map(Number)]);
  if (family === 6) {
    const words = ipv6Words(host);
    if (words === null) return null;
    const address = Buffer.alloc(17);
    address[0] = 0x04;
    for (const [index, word] of words.entries()) address.writeUInt16BE(word, 1 + index * 2);
    return address;
  }
  const name = Buffer.from(host);
  if (name.length === 0 || name.length > 255) return null;
  return Buffer.concat([Buffer.from([0x03, name.length]), name]);
}

/** Collects the bytes of a socket until a step of the SOCKS5 exchange has all of them. */
function socksExchange(
  socket: Socket,
  steps: readonly ((data: Buffer) => number | "fail" | "signIn" | null)[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    let step = 0;
    const done = (error: Error | null) => {
      socket.off("data", received);
      socket.off("error", failed);
      socket.off("close", closed);
      clearTimeout(timer);
      if (error) return reject(error);
      // The tunnel reads the rest. Until it does, no byte may go to a socket without a reader.
      socket.pause();
      resolve(data);
    };
    const received = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      for (;;) {
        const current = steps[step];
        if (current === undefined) return done(null);
        const used = current(data);
        if (used === "fail") return done(new Error("The SOCKS5 proxy refused the request"));
        if (used === "signIn") return done(new ProxySignInRefused("The SOCKS5 proxy refused the sign-in"));
        if (used === null) return;
        data = data.subarray(used);
        step += 1;
      }
    };
    const failed = (error: Error) => done(error);
    const closed = () => done(new Error("The SOCKS5 proxy closed the connection"));
    const timer = setTimeout(() => done(new Error("The SOCKS5 proxy did not answer")), SOCKS_TIMEOUT_MS);
    socket.on("data", received);
    socket.on("error", failed);
    socket.on("close", closed);
  });
}

/** Opens a connection to a site through the SOCKS5 proxy. The promise gives the bytes the proxy sent early. */
async function openSocksConnection(upstream: SocksUpstream, target: RelayTarget, socket: Socket): Promise<Buffer> {
  const address = socksAddress(target.host);
  const username = Buffer.from(upstream.username);
  const password = Buffer.from(upstream.password);
  if (address === null || username.length > 255 || password.length > 255)
    throw new Error("The SOCKS5 request is too long");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The SOCKS5 proxy did not answer")), SOCKS_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const port = Buffer.alloc(2);
  port.writeUInt16BE(target.port);
  // Each step writes the next message when the proxy accepts the one before it.
  const exchange = socksExchange(socket, [
    (data) => {
      if (data.length < 2) return null;
      if (data[0] !== 0x05) return "fail";
      // 0xff: the proxy takes no sign-in, or a different kind of sign-in.
      if (data[1] !== 0x02) return "signIn";
      socket.write(
        Buffer.concat([Buffer.from([0x01, username.length]), username, Buffer.from([password.length]), password]),
      );
      return 2;
    },
    (data) => {
      if (data.length < 2) return null;
      if (data[1] !== 0x00) return "signIn";
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), address, port]));
      return 2;
    },
    (data) => {
      if (data.length < 5) return null;
      if (data[0] !== 0x05 || data[1] !== 0x00) return "fail";
      const addressLength = data[3] === 0x01 ? 4 : data[3] === 0x04 ? 16 : data[3] === 0x03 ? 1 + (data[4] ?? 0) : -1;
      if (addressLength < 0) return "fail";
      const length = 4 + addressLength + 2;
      return data.length < length ? null : length;
    },
  ]);
  // Offer only the user name and password method: without the sign-in, the proxy must refuse.
  socket.write(Buffer.from([0x05, 0x01, 0x02]));
  return exchange;
}

/** A SOCKS5 proxy with a sign-in as the exit of a relay. */
export function socksExit(upstream: SocksUpstream): RelayExit {
  return async (target, signal) => {
    // The address keeps an IPv6 host in brackets; a socket takes it without them.
    const site = connect({ host: upstream.host.replace(/^\[(.*)\]$/u, "$1"), port: upstream.port });
    site.setNoDelay(true);
    const abort = () => site.destroy(new Error("The connection was stopped"));
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) abort();
      return { stream: site, early: await openSocksConnection(upstream, target, site) };
    } catch (error) {
      site.destroy();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
}

/** Reads the request head of one browser connection, then joins it to the site through the exit. */
function relayConnection(
  client: Socket,
  exit: RelayExit,
  authorization: Buffer,
  open: Set<() => void>,
  noteExit: (failure: BrowserProxyFailure | null) => void,
): void {
  let head = Buffer.alloc(0);
  const fail = (response: string) => {
    if (!client.destroyed) client.end(response);
  };
  const headTimer = setTimeout(() => client.destroy(), HEAD_TIMEOUT_MS);
  client.on("error", () => client.destroy());
  client.once("close", () => clearTimeout(headTimer));
  const received = (chunk: Buffer) => {
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end < 0) {
      if (head.length > HEAD_MAX_BYTES) {
        client.off("data", received);
        fail(BAD_REQUEST);
      }
      return;
    }
    client.off("data", received);
    client.pause();
    clearTimeout(headTimer);
    const early = head.subarray(end + 4);
    const request = parseRequest(head.subarray(0, end).toString("latin1"), authorization);
    if (request === null) return fail(BAD_REQUEST);
    if (request === "signIn") return fail(SIGN_IN_REQUIRED);
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    open.add(stop);
    client.once("close", stop);
    exit(request.target, attempt.signal).then(
      ({ stream: site, early: fromSite }) => {
        open.delete(stop);
        noteExit(null);
        if (client.destroyed) return site.destroy();
        const close = () => site.destroy();
        open.add(close);
        site.once("close", () => {
          open.delete(close);
          client.destroy();
        });
        client.once("close", close);
        site.on("error", () => site.destroy());
        if (request.tunnel) client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        else site.write(request.head);
        if (fromSite.length > 0) client.write(fromSite);
        if (early.length > 0) site.write(early);
        client.pipe(site);
        site.pipe(client);
        client.resume();
      },
      (error: unknown) => {
        open.delete(stop);
        // An attempt that the browser or the relay stopped says nothing about the proxy.
        if (!attempt.signal.aborted) noteExit(error instanceof ProxySignInRefused ? "signIn" : "unreachable");
        fail(BAD_GATEWAY);
      },
    );
  };
  client.on("data", received);
}

/** Starts a relay on a free port of 127.0.0.1 for one exit. */
export const openBrowserProxyRelay = Effect.fn("openBrowserProxyRelay")(function* (
  exit: RelayExit,
): Effect.fn.Return<BrowserProxyRelay, BrowserOperationError> {
  const password = randomBytes(24).toString("base64url");
  const authorization = Buffer.from(`Basic ${Buffer.from(`${RELAY_USERNAME}:${password}`).toString("base64")}`);
  // A stop function for each browser connection, attempt, and site connection.
  const open = new Set<() => void>();
  let exitFailure: BrowserProxyFailure | null = null;
  const noteExit = (failure: BrowserProxyFailure | null) => {
    exitFailure = failure;
  };
  const server: Server = createServer((client) => {
    const close = () => client.destroy();
    open.add(close);
    client.once("close", () => open.delete(close));
    client.setNoDelay(true);
    relayConnection(client, exit, authorization, open, noteExit);
  });
  server.maxConnections = MAX_CONNECTIONS;
  const port = yield* Effect.callback<number, BrowserOperationError>((resume) => {
    const failed = (cause: Error) => resume(Effect.fail(browserFailure(cause)));
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", failed);
      // A connection that the computer cannot accept fails alone. The relay keeps its port.
      server.on("error", () => {});
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        resume(Effect.fail(browserFailure(new Error("The proxy relay has no port"))));
        return;
      }
      resume(Effect.succeed(address.port));
    });
    return Effect.sync(() => {
      server.off("error", failed);
      server.close();
    });
  });
  const close = Effect.callback<void>((resume) => {
    server.close(() => resume(Effect.void));
    const stops = [...open];
    open.clear();
    for (const stop of stops) stop();
  });
  return { host: "127.0.0.1", port, username: RELAY_USERNAME, password, exitFailure: () => exitFailure, close };
});
