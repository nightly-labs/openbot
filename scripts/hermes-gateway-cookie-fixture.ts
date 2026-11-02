// Synthetic cookie lifecycle from the pinned Hermes basic provider, cookies.py, middleware.py
// and webapp_sign_in.py. This is a local protocol fixture, not a running Hermes installation.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { redactText, redactValue } from "@openbot/logging";
import { Effect, Result } from "effect";
import { WebSocketServer } from "ws";
import { HermesGatewayConnection } from "../src/main/hermes-gateway-connection";
import type { HermesGatewayFailure } from "../src/main/hermes-gateway-protocol";

interface FixtureTls {
  key: string;
  cert: string;
}
interface SessionTokens {
  identity: string;
  at: string;
  rt: string;
  binding: string;
}
interface CookieFixtureOptions {
  tls?: FixtureTls | undefined;
  path?: "" | "/hermes" | undefined;
  additionalCookies?: readonly string[] | undefined;
  expiredTicket?: boolean | undefined;
  holdUpgrade?: (() => Promise<void>) | undefined;
}

const LOGIN_PASSWORD = "cookie-lifecycle-fixture-password";
const GATEWAY = createHash("sha256").update("/synthetic/hermes/home").digest("hex").slice(0, 16);

// basic._sign: compact JSON + HMAC-SHA256, then URL-safe base64 WITH its padding.
function signedToken(identity: string, kind: "access" | "refresh"): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: identity,
      kind,
      exp: Math.floor(Date.now() / 1_000) + (kind === "access" ? 900 : 30 * 24 * 3600),
      jti: randomBytes(16).toString("base64url"),
    }),
  );
  const signature = createHmac("sha256", "synthetic-fixture-signing-key").update(payload).digest();
  return Buffer.concat([payload, signature]).toString("base64").replaceAll("+", "-").replaceAll("/", "_");
}

// Python SimpleCookie's coded_value for the URL-safe base64 alphabet used by basic._sign.
// '=' is outside its unquoted legal-key alphabet, so padded values are double-quoted.
function wireValue(raw: string): string {
  return raw.includes("=") ? `"${raw}"` : raw;
}

function requestCookies(header: string | undefined): Map<string, string> {
  return new Map(
    (header ?? "")
      .split("; ")
      .filter(Boolean)
      .map((pair) => {
        const separator = pair.indexOf("=");
        const value = pair.slice(separator + 1);
        return [pair.slice(0, separator), value.startsWith('"') ? value.slice(1, -1) : value];
      }),
  );
}

async function cookieFixture(options: CookieFixtureOptions = {}) {
  const path = options.path ?? "/hermes";
  const prefix = options.tls ? (path ? "__Secure-" : "__Host-") : "";
  const name = (kind: "at" | "rt" | "provider" | "binding") =>
    `${prefix}hermes_${kind === "binding" ? "webapp_signin" : `session_${kind}`}_${GATEWAY}`;
  const binding = createHmac("sha256", "synthetic-webapp-browser-credential").update("sign-in binding").digest("hex");
  const issued: SessionTokens[] = [];
  const access = new Map<string, string>();
  const refresh = new Map<string, string>();
  const expired = new Set<string>();
  const current = new Map<string, SessionTokens>();
  const refreshedWith: string[] = [];
  const requests: { route: string; cookies: Map<string, string>; wire: string }[] = [];
  const tickets = new Map<string, number>();
  let cookieExpiryIdentity: string | undefined;
  let rejectBinding = false;
  let upgrades = 0;
  let mintCount = 0;
  let loginCount = 0;
  let expectedOrigin = "";

  const mint = (identity: string): SessionTokens => {
    const tokens = { identity, at: signedToken(identity, "access"), rt: signedToken(identity, "refresh"), binding };
    access.set(tokens.at, identity);
    refresh.set(tokens.rt, identity);
    current.set(identity, tokens);
    issued.push(tokens);
    return tokens;
  };
  const setCookies = (response: ServerResponse, tokens: SessionTokens, expireAccess = false) => {
    const attributes = `Path=${path || "/"}; ${options.tls ? "Secure; " : ""}HttpOnly; SameSite=lax; Max-Age=`;
    response.setHeader("set-cookie", [
      `${name("at")}=${expireAccess ? '""' : wireValue(tokens.at)}; ${attributes}${expireAccess ? 0 : 900}`,
      `${name("rt")}=${wireValue(tokens.rt)}; ${attributes}${30 * 24 * 3600}`,
      `${name("provider")}=basic; ${attributes}${30 * 24 * 3600}`,
      `${name("binding")}=${tokens.binding}; ${attributes}${30 * 24 * 3600}`,
      ...(options.additionalCookies ?? []),
    ]);
  };

  const server = options.tls ? createSecureServer(options.tls) : createServer();
  server.on("request", async (request, response) => {
    assert.ok(request.headers.origin === expectedOrigin, "REST Origin is pinned to the gateway origin.");
    const route = request.url?.slice(path.length) ?? "";
    assert.ok(request.url === `${path}${route}`, "Proxy prefix is kept on each request.");
    const cookies = requestCookies(request.headers.cookie);
    requests.push({ route, cookies, wire: request.headers.cookie ?? "" });
    response.setHeader("content-type", "application/json");
    if (route === "/api/status") return response.end('{"auth_required":true}');
    if (route === "/api/auth/providers")
      return response.end('{"providers":[{"name":"basic","display_name":"Password","supports_password":true}]}');
    if (route === "/auth/password-login") {
      loginCount += 1;
      assert.ok(cookies.size === 0, "Explicit login has no previous account cookies.");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.ok(input.password === LOGIN_PASSWORD && input.provider === "basic", "Synthetic credentials match.");
      setCookies(response, mint(input.username));
      return response.end('{"ok":true}');
    }
    if (rejectBinding || cookies.get(name("binding")) !== binding || cookies.get(name("provider")) !== "basic") {
      response.statusCode = 401;
      return response.end('{"error":"unauthenticated","reason":"signed_out"}');
    }
    let identity = access.get(cookies.get(name("at")) ?? "");
    if (expired.has(cookies.get(name("at")) ?? "")) identity = undefined;
    if (!identity) {
      // The pinned cookie middleware refreshes an absent/expired AT and serves THIS request.
      const rt = cookies.get(name("rt")) ?? "";
      identity = refresh.get(rt);
      if (!identity) {
        response.statusCode = 401;
        return response.end('{"error":"unauthenticated","reason":"invalid_or_expired_session"}');
      }
      refreshedWith.push(rt);
      setCookies(response, mint(identity));
    }
    if (route === "/api/auth/me")
      return response.end(
        JSON.stringify({
          user_id: identity,
          provider: "basic",
          expires_at: Math.floor(Date.now() / 1_000) + 900,
        }),
      );
    if (route === "/api/profiles") {
      if (cookieExpiryIdentity === identity) {
        const tokens = current.get(identity);
        assert.ok(tokens, "A synthetic session is active.");
        setCookies(response, tokens, true);
        cookieExpiryIdentity = undefined;
      }
      return response.end(JSON.stringify({ profiles: [{ name: `${identity}-profile`, is_default: true }] }));
    }
    if (route === "/api/auth/ws-ticket") {
      mintCount += 1;
      const ticket = randomBytes(32).toString("base64url");
      tickets.set(ticket, Date.now() + (options.expiredTicket ? -1 : 30_000));
      return response.end(JSON.stringify({ ticket, ttl_seconds: 30 }));
    }
    response.statusCode = 404;
    response.end("{}");
  });
  const sockets = new WebSocketServer({ noServer: true, handleProtocols: () => "hermes-gateway-v1" });
  server.on("upgrade", async (request, socket, head) => {
    upgrades += 1;
    assert.ok(request.headers.origin === expectedOrigin, "Socket Origin matches the REST gateway.");
    assert.ok(request.url === `${path}/api/ws`, "Socket URL has the proxy prefix and no secret.");
    assert.ok(!request.headers.cookie && !request.headers.authorization, "Only a ticket is sent on upgrade.");
    const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
    const ticket = protocols.find((value) => value.startsWith("hermes-gateway-ticket."))?.slice(22) ?? "";
    const expiry = tickets.get(ticket) ?? 0;
    tickets.delete(ticket); // Single use, including a refused expired ticket.
    await options.holdUpgrade?.();
    if (socket.destroyed) return;
    if (expiry <= Date.now()) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (connection) => {
      connection.on("message", () => assert.fail("The foundation must send no RPC, turn or approval."));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  expectedOrigin = `${options.tls ? "https" : "http"}://127.0.0.1:${address.port}`;
  return {
    url: `${expectedOrigin}${path}`,
    requests,
    issued,
    refreshedWith,
    name,
    get upgrades() {
      return upgrades;
    },
    get mintCount() {
      return mintCount;
    },
    get loginCount() {
      return loginCount;
    },
    expireServerAccess(identity: string) {
      const tokens = current.get(identity);
      assert.ok(tokens, "The synthetic identity exists.");
      expired.add(tokens.at);
    },
    expireBrowserAccess(identity: string) {
      cookieExpiryIdentity = identity;
    },
    revokeBinding() {
      rejectBinding = true;
    },
    latest(identity: string) {
      const tokens = current.get(identity);
      assert.ok(tokens, "The synthetic identity exists.");
      return tokens;
    },
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

async function expectedFailure<A>(
  operation: Effect.Effect<A, HermesGatewayFailure>,
  code: HermesGatewayFailure["code"],
) {
  const result = await Effect.runPromise(Effect.result(operation));
  assert.ok(Result.isFailure(result) && result.failure.code === code, "The expected fixed failure code is returned.");
}

/** This regression failed on the first PR commit: the decoded padded token was not registered. */
export async function checkQuotedCookieLifecycle(tls?: FixtureTls, path?: "" | "/hermes") {
  const gateway = await cookieFixture({ tls, path });
  const alice = await Effect.runPromise(HermesGatewayConnection.create(gateway.url));
  const bob = await Effect.runPromise(HermesGatewayConnection.create(gateway.url));
  const providerBefore = redactText("basic");
  try {
    await Promise.all([
      Effect.runPromise(alice.signInPassword("basic", "alice", LOGIN_PASSWORD)),
      Effect.runPromise(bob.signInPassword("basic", "bob", LOGIN_PASSWORD)),
    ]);
    const assertRedacted = () => {
      assert.ok(
        gateway.issued.some((tokens) => tokens.at.endsWith("=") || tokens.rt.endsWith("=")),
        "The fixture exercises Python-style quoted base64 padding.",
      );
      for (const tokens of gateway.issued)
        for (const raw of [tokens.at, tokens.rt, tokens.binding]) {
          assert.ok(!redactText(raw).includes(raw), "A raw token must be redacted without needing its cookie label.");
          assert.ok(
            !redactText(wireValue(raw)).includes(raw),
            "A wire token must be redacted without its cookie label.",
          );
          assert.ok(
            !JSON.stringify(redactValue({ detail: raw })).includes(raw),
            "Structured diagnostics redact the raw token.",
          );
        }
      assert.ok(redactText("basic") === providerBefore, "The provider routing hint must not register as a secret.");
    };
    assertRedacted();
    let results = await Promise.all([Effect.runPromise(alice.listProfiles()), Effect.runPromise(bob.listProfiles())]);
    assert.ok(
      results[0][0]?.name === "alice-profile" && results[1][0]?.name === "bob-profile",
      "Concurrent identities stay separate.",
    );
    const original = gateway.latest("alice");
    gateway.expireServerAccess("alice");
    const count = gateway.requests.length;
    await Effect.runPromise(alice.listProfiles());
    assert.ok(
      gateway.requests.length === count + 1 && gateway.refreshedWith.length === 1,
      "The gateway refreshes the original request without a client retry.",
    );
    assert.ok(gateway.refreshedWith[0] === original.rt, "Refresh receives this identity's RT.");
    const rotated = gateway.latest("alice");
    gateway.expireBrowserAccess("alice");
    await Effect.runPromise(alice.listProfiles()); // Reply deletes the AT cookie, as its browser Max-Age does.
    const beforeRefresh = gateway.requests.length;
    await Effect.runPromise(alice.listProfiles());
    const missingAt = gateway.requests[beforeRefresh];
    assert.ok(missingAt && !missingAt.cookies.has(gateway.name("at")), "An evicted AT is not sent again.");
    assert.ok(
      gateway.refreshedWith[1] === rotated.rt && rotated.rt !== original.rt,
      "The next refresh uses the replacement RT and never replays the old RT.",
    );
    assert.ok(
      gateway.requests.length === beforeRefresh + 1 && gateway.loginCount === 2,
      "Refresh does not add a request or repeat password login.",
    );
    assertRedacted();
    results = await Promise.all([Effect.runPromise(alice.listProfiles()), Effect.runPromise(bob.listProfiles())]);
    assert.ok(
      results[0][0]?.name === "alice-profile" && results[1][0]?.name === "bob-profile",
      "Refresh preserves account isolation.",
    );
    for (const tokens of gateway.issued) {
      for (const kind of ["at", "rt"] as const) {
        assert.ok(
          gateway.requests.some((request) => request.wire.includes(`${gateway.name(kind)}=${wireValue(tokens[kind])}`)),
          "Accepted cookie wire quoting is preserved on the next authenticated request.",
        );
      }
    }
    gateway.revokeBinding();
    await expectedFailure(alice.listProfiles(), "authentication");
    const rejectedCount = gateway.requests.length;
    await expectedFailure(alice.listProfiles(), "authentication");
    assert.ok(gateway.requests.length === rejectedCount, "A revoked binding clears the local session without retry.");
    assert.ok(gateway.upgrades === 2 && gateway.mintCount === 2, "Each explicit sign-in uses one fresh ticket, once.");
  } finally {
    alice.close();
    bob.close();
    await gateway.close();
  }
}

/** Invalid cookies and provider hints must not change process-wide log masking. */
export async function checkRejectedCookieRedaction(tls?: FixtureTls) {
  const markers = [
    "rejected-domain-marker-long",
    "rejected-path-marker-long",
    "rejected-httponly-marker-long",
    "rejected-expiry-marker-long",
    "rejected-secure-marker-long",
    "ok",
  ];
  const before = markers.map((marker) => redactText(marker));
  const attributes = `Path=/hermes; ${tls ? "Secure; " : ""}HttpOnly; Max-Age=3600`;
  const gateway = await cookieFixture({
    tls,
    additionalCookies: [
      `hermes_session_rt_domain=${markers[0]}; ${attributes}; Domain=127.0.0.1`,
      `hermes_session_rt_path=${markers[1]}; Path=/elsewhere; HttpOnly; Max-Age=3600`,
      `hermes_session_rt_httponly=${markers[2]}; Path=/hermes; Max-Age=3600`,
      `hermes_session_rt_expiry=${markers[3]}; Path=/hermes; HttpOnly; Max-Age=0`,
      `hermes_session_rt_secure=${markers[4]}; Path=/hermes; HttpOnly; Max-Age=3600${tls ? "" : "; Secure"}`,
      `hermes_session_rt_short="${markers[5]}"; ${attributes}`,
    ],
  });
  const client = await Effect.runPromise(HermesGatewayConnection.create(gateway.url));
  try {
    await Effect.runPromise(client.signInPassword("basic", "alice", LOGIN_PASSWORD));
    assert.ok(
      markers.every((marker, index) => redactText(marker) === before[index]),
      "Rejected and short remote values must not poison the global redactor.",
    );
    for (const request of gateway.requests) {
      assert.ok(
        [...request.cookies.values()].every((value) => !markers.includes(value)),
        "Rejected and short secret cookies must not reach an authenticated request.",
      );
    }
  } finally {
    client.close();
    await gateway.close();
  }
}

/** A token cookie must not become a provider hint because of text in its gateway suffix. */
export async function checkCookieSuffixRedaction(tls?: FixtureTls, path: "" | "/hermes" = "/hermes") {
  const prefix = tls ? (path ? "__Secure-" : "__Host-") : "";
  const attributes = `Path=${path || "/"}; ${tls ? "Secure; " : ""}HttpOnly; Max-Age=3600`;
  const secrets = ["session_at", "session_rt", "webapp_signin"].map((role) => ({
    name: `${prefix}hermes_${role}_hermes_session_provider`,
    raw: randomBytes(32).toString("base64").replaceAll("+", "-").replaceAll("/", "_"),
  }));
  const shortName = `${prefix}hermes_session_at_hermes_session_provider_short`;
  const short = "ix";
  const shortBefore = redactText(short);
  const hintName = `${prefix}hermes_session_provider_hermes_session_at`;
  const hint = "nonsecret-provider-routing-label";
  const hintBefore = redactText(hint);
  const gateway = await cookieFixture({
    tls,
    path,
    additionalCookies: [
      ...secrets.map(({ name, raw }) => `${name}=${wireValue(raw)}; ${attributes}`),
      `${shortName}=${short}; ${attributes}`,
      `${hintName}=${hint}; ${attributes}`,
    ],
  });
  const client = await Effect.runPromise(HermesGatewayConnection.create(gateway.url));
  try {
    await Effect.runPromise(client.signInPassword("basic", "alice", LOGIN_PASSWORD));
    for (const { name, raw } of secrets) {
      assert.ok(
        !redactText(raw).includes(raw) && !redactText(wireValue(raw)).includes(raw),
        "Token roles must stay secret when the gateway suffix contains provider-hint text.",
      );
      assert.ok(
        gateway.requests.some((request) => request.cookies.get(name) === raw),
        "An accepted adversarial-suffix token remains protected on authenticated transport.",
      );
    }
    assert.ok(
      gateway.requests.every((request) => !request.cookies.has(shortName)),
      "A misleading gateway suffix must not bypass the minimum secret-token length.",
    );
    assert.ok(redactText(short) === shortBefore, "A rejected short suffix token must not change global masking.");
    assert.ok(
      gateway.requests.some((request) => request.cookies.get(hintName) === hint),
      "A genuine provider hint remains usable when its suffix contains token-role text.",
    );
    assert.ok(redactText(hint) === hintBefore, "A genuine provider hint must remain nonsecret.");
  } finally {
    client.close();
    await gateway.close();
  }
}

export async function checkCookieSocketFailures() {
  const gateway = await cookieFixture({ expiredTicket: true });
  const client = await Effect.runPromise(HermesGatewayConnection.create(gateway.url));
  try {
    await expectedFailure(client.signInPassword("basic", "alice", LOGIN_PASSWORD), "socket-rejected");
    assert.ok(gateway.mintCount === 1 && gateway.upgrades === 1, "An expired ticket is not replayed or reminted.");
  } finally {
    client.close();
    await gateway.close();
  }

  let enteredUpgrade: () => void = () => {};
  let releaseUpgrade: () => void = () => {};
  const entered = new Promise<void>((done) => {
    enteredUpgrade = done;
  });
  const released = new Promise<void>((done) => {
    releaseUpgrade = done;
  });
  const held = await cookieFixture({
    holdUpgrade: () => {
      enteredUpgrade();
      return released;
    },
  });
  const connection = await Effect.runPromise(HermesGatewayConnection.create(held.url));
  try {
    const signingIn = expectedFailure(connection.signInPassword("basic", "alice", LOGIN_PASSWORD), "closed");
    await entered;
    connection.close();
    releaseUpgrade();
    await signingIn;
    assert.ok(held.mintCount === 1 && held.upgrades === 1, "Interrupted admission does not reconnect.");
  } finally {
    connection.close();
    releaseUpgrade();
    await held.close();
  }
}
