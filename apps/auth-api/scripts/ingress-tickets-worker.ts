import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseIngressTicketRoutes } from "@openbot/contracts/remote-control-plane";
import { Cause, Effect, Exit, Schema } from "effect";
import { RemoteControlPlane, RemoteControlPlaneError } from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const OWNER = "ingress-owner";
const NOT_FOUND_PAGE = "<!DOCTYPE html><html><head><title>Not Found</title></head><body>Not Found</body></html>";

interface D1Counts {
  roundTrips: number;
  statements: number;
  batches: number;
}

interface ShimMode {
  combined: boolean;
  telegram: boolean;
  failWebhook: number;
}

const ShimBody = Schema.Struct({
  machineToken: Schema.optional(Schema.String),
  signalHome: Schema.optional(Schema.Boolean),
  routes: Schema.optional(Schema.Array(Schema.String)),
  hostId: Schema.optional(Schema.String),
  combined: Schema.optional(Schema.Boolean),
  telegram: Schema.optional(Schema.Boolean),
  failWebhook: Schema.optional(Schema.Number),
});
type ShimBody = typeof ShimBody.Type;
const decodeShimBody = Schema.decodeUnknownSync(Schema.fromJsonString(ShimBody));

let seededHosts = 0;
const counts: D1Counts = { roundTrips: 0, statements: 0, batches: 0 };
const requests: string[] = [];
const mode: ShimMode = { combined: true, telegram: true, failWebhook: 0 };

function countingD1(database: DatabaseSync): D1Database {
  const source = sqliteD1(database);
  const inner = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const counted = (): void => {
      counts.roundTrips += 1;
      counts.statements += 1;
    };
    const wrapped: D1PreparedStatement = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      first: (column?: string) => {
        counted();
        return column === undefined ? statement.first() : statement.first(column);
      },
      all: () => {
        counted();
        return statement.all();
      },
      run: () => {
        counted();
        return statement.run();
      },
      raw: statement.raw.bind(statement),
    };
    inner.set(wrapped, statement);
    return wrapped;
  };
  return {
    prepare: (query) => wrap(source.prepare(query)),
    batch: (statements) => {
      counts.roundTrips += 1;
      counts.batches += 1;
      counts.statements += statements.length;
      return source.batch(statements.map((statement) => inner.get(statement) ?? statement));
    },
    exec: (query) => source.exec(query),
    withSession: () => ({
      prepare: (query) => wrap(source.prepare(query)),
      batch: (statements) => {
        counts.roundTrips += 1;
        counts.batches += 1;
        counts.statements += statements.length;
        return source.batch(statements.map((statement) => inner.get(statement) ?? statement));
      },
      getBookmark: () => null,
    }),
    dump: () => source.dump(),
  };
}

async function migratedDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of (await readdir(MIGRATIONS)).sort()) database.exec(await readFile(join(MIGRATIONS, name), "utf8"));
  database
    .prepare("INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES (?, 'email:ingress', ?, 1, 1)")
    .run(OWNER, "ingress-owner@example.test");
  return database;
}

function seedHost(database: DatabaseSync, input: { hostId: string; machineToken: string; telegramBotId: string }) {
  const now = Date.now();
  seededHosts += 1;
  const seeded = {
    slackTeamId: `T0INGRESS${seededHosts}`,
    telegramChatId: `-100${seededHosts}`,
    webhookRouteId: `route-${input.hostId}`,
  };
  database
    .prepare(
      `INSERT INTO remote_hosts(host_id, owner_user_id, name, machine_token_hash, created_at, updated_at)
       VALUES (?, ?, 'Ingress host', ?, 1, 1)`,
    )
    .run(input.hostId, OWNER, createHash("sha256").update(input.machineToken).digest("base64url"));
  database
    .prepare(
      `INSERT INTO slack_workspace_routes(team_id, host_id, account_id, app_id, bot_user_id, connected_at)
       VALUES (?, ?, ?, 'A0INGRESS1', 'U0INGRESS1', ?)`,
    )
    .run(seeded.slackTeamId, input.hostId, OWNER, now);
  database
    .prepare("INSERT INTO discord_guild_routes(guild_id, host_id, account_id, connected_at) VALUES (?, ?, ?, ?)")
    .run(`10000000000000000${seededHosts}`, input.hostId, OWNER, now);
  database
    .prepare("INSERT INTO telegram_chat_routes(bot_id, chat_id, host_id, account_id, linked_at) VALUES (?, ?, ?, ?, ?)")
    .run(input.telegramBotId, seeded.telegramChatId, input.hostId, OWNER, now);
  database
    .prepare("INSERT INTO webhook_routes(route_id, host_id, account_id, connected_at) VALUES (?, ?, ?, ?)")
    .run(seeded.webhookRouteId, input.hostId, OWNER, now);
  return seeded;
}

async function signingKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = JSON.stringify({ ...(await crypto.subtle.exportKey("jwk", pair.privateKey)), kid: "ingress-1" });
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "ingress-1", alg: "ES256" };
  return {
    publicJwk,
    bindings: {
      REMOTE_TICKET_PRIVATE_JWK: privateJwk,
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
      REMOTE_TICKET_KEY_ID: "ingress-1",
      SLACK_ROUTE_PRIVATE_JWK: privateJwk,
      SLACK_ROUTE_KEY_ID: "ingress-1",
      DISCORD_ROUTE_PRIVATE_JWK: privateJwk,
      DISCORD_ROUTE_KEY_ID: "ingress-1",
    },
  };
}

const signalUrl = process.env.INGRESS_E2E_SIGNAL_URL ?? "";
const telegramBotId = process.env.INGRESS_E2E_TELEGRAM_BOT_ID ?? "";
if (!signalUrl || !telegramBotId)
  throw new Error("INGRESS_E2E_SIGNAL_URL and INGRESS_E2E_TELEGRAM_BOT_ID are required.");
const database = await migratedDatabase();
const DB = countingD1(database);
const keys = await signingKeys();
const planes = {
  withTelegram: new RemoteControlPlane({
    DB,
    REMOTE_SIGNAL_URL: signalUrl,
    TELEGRAM_BOT_ID: telegramBotId,
    TELEGRAM_BOT_USERNAME: "openbot_ingress_e2e_bot",
    ...keys.bindings,
  }),
  withoutTelegram: new RemoteControlPlane({ DB, REMOTE_SIGNAL_URL: signalUrl, ...keys.bindings }),
};

function errorResponse(error: unknown): Response {
  if (error instanceof RemoteControlPlaneError)
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return Response.json({ error: { code: "internal_error", message: "The shim failed." } }, { status: 500 });
}

async function answer<A>(operation: Effect.Effect<A, unknown>, change?: (value: A) => object): Promise<Response> {
  const exit = await Effect.runPromiseExit(operation);
  if (Exit.isSuccess(exit)) return Response.json(change ? change(exit.value) : exit.value);
  return errorResponse(Cause.squash(exit.cause));
}

function webhookFault(): boolean {
  if (mode.failWebhook <= 0) return false;
  mode.failWebhook -= 1;
  return true;
}

const unavailable = () =>
  Response.json({ error: { code: "remote_unavailable", message: "The route is not available." } }, { status: 503 });

async function hostRoute(hostId: string, action: string, body: ShimBody): Promise<Response> {
  if (body.machineToken === undefined)
    return Response.json({ error: { code: "invalid_remote_request", message: "Invalid." } }, { status: 400 });
  const plane = mode.telegram ? planes.withTelegram : planes.withoutTelegram;
  const token = body.machineToken;
  if (action === "ticket") {
    const signalHome = body.signalHome ?? null;
    return answer(plane.issueHostTicket(hostId, token, { signalHome, failedSignalUrl: null, location: null }));
  }
  if (action === "slack-route") return answer(plane.issueSlackRoute(hostId, token));
  if (action === "discord-route") return answer(plane.issueDiscordRoute(hostId, token));
  if (action === "telegram-route") return answer(plane.issueTelegramRoute(hostId, token));
  if (action === "webhook-route")
    return webhookFault() ? unavailable() : answer(plane.issueWebhookRoute(hostId, token));
  if (action === "ingress-tickets") {
    if (!mode.combined) return new Response(NOT_FOUND_PAGE, { status: 404, headers: { "Content-Type": "text/html" } });
    const wanted = parseIngressTicketRoutes(body.routes);
    if (!wanted)
      return Response.json({ error: { code: "invalid_remote_request", message: "Invalid." } }, { status: 400 });
    const fault = wanted.has("webhook") && webhookFault();
    return answer(plane.issueIngressTickets(hostId, token, wanted), (issued) =>
      fault ? { ...issued, routes: { ...issued.routes, webhook: { error: "remote_unavailable" } } } : issued,
    );
  }
  return new Response(NOT_FOUND_PAGE, { status: 404, headers: { "Content-Type": "text/html" } });
}

async function control(path: string, body: ShimBody): Promise<Response> {
  if (path === "/__stats") return Response.json({ requests: [...requests], d1: { ...counts } });
  if (path === "/__reset") {
    requests.length = 0;
    counts.roundTrips = 0;
    counts.statements = 0;
    counts.batches = 0;
    return Response.json({});
  }
  if (path === "/__mode") {
    if (body.combined !== undefined) mode.combined = body.combined;
    if (body.telegram !== undefined) mode.telegram = body.telegram;
    if (body.failWebhook !== undefined) mode.failWebhook = body.failWebhook;
    return Response.json({ ...mode });
  }
  if (path === "/__host" && body.hostId !== undefined && body.machineToken !== undefined) {
    return Response.json(seedHost(database, { hostId: body.hostId, machineToken: body.machineToken, telegramBotId }));
  }
  return new Response("not found", { status: 404 });
}

const HOST_ROUTE = /^\/v2\/remote\/hosts\/([^/]+)\/([a-z-]+)$/u;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const text = request.method === "POST" ? await request.text() : "";
    const body = decodeShimBody(text || "{}");
    if (path.startsWith("/__")) return control(path, body);
    requests.push(body.routes ? `${path}#${body.routes.join(",")}` : path);
    const route = HOST_ROUTE.exec(path);
    if (request.method !== "POST" || !route?.[1] || !route[2])
      return new Response(NOT_FOUND_PAGE, { status: 404, headers: { "Content-Type": "text/html" } });
    return hostRoute(decodeURIComponent(route[1]), route[2], body);
  },
});

process.stdout.write(`${JSON.stringify({ port: server.port, publicJwk: keys.publicJwk })}\n`);
