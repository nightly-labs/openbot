import { Option, Schema } from "effect";
import { createWorkerHandler } from "../src/server/worker-handler";
import { routeHandler } from "./session-cache-e2e-route-registry";
import "./session-cache-e2e-routes";

interface HarnessBindings {
  DB: D1Database;
  MARKETPLACE_INGRESS_RATE_LIMITER: RateLimit;
  SITE_REPORT_HASH_SECRET?: string;
  PEER?: Fetcher;
}

const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

const statements = new Map<string, number>();
let total = 0;
let counting = true;
let sending = false;
const patchedPrototypes = new WeakSet<object>();

function note(query: unknown) {
  if (!counting) return;
  for (const sql of Array.isArray(query) ? query : [query]) {
    const key = String(sql).replace(/\s+/gu, " ").trim().slice(0, 120);
    total += 1;
    statements.set(key, (statements.get(key) ?? 0) + 1);
  }
}

function patchSend(holder: object | undefined) {
  if (!holder) return;
  for (
    let proto = Object.getPrototypeOf(holder);
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    if (patchedPrototypes.has(proto) || !Object.hasOwn(proto, "_sendOrThrow")) continue;
    if (!("_sendOrThrow" in proto) || typeof proto._sendOrThrow !== "function") continue;
    patchedPrototypes.add(proto);
    const original = proto._sendOrThrow;
    proto._sendOrThrow = function (this: object, ...args: unknown[]) {
      const outer = !sending;
      if (outer) note(args[1]);
      sending = true;
      try {
        return original.apply(this, args);
      } finally {
        if (outer) sending = false;
      }
    };
  }
}

function patchDatabase(database: D1Database) {
  patchSend(database);
  patchSend(
    "alwaysPrimarySession" in database && typeof database.alwaysPrimarySession === "object"
      ? (database.alwaysPrimarySession ?? undefined)
      : undefined,
  );
  patchSend(database.withSession("first-primary"));
  patchSend(database.withSession("first-unconstrained"));
}

function counts(reset: boolean) {
  const result = { total, statements: Object.fromEntries(statements) };
  if (reset) {
    total = 0;
    statements.clear();
  }
  return result;
}

async function uncounted<A>(operation: () => Promise<A>): Promise<A> {
  counting = false;
  try {
    return await operation();
  } finally {
    counting = true;
  }
}

const ControlBody = Schema.Struct({
  offsetMs: Schema.optional(Schema.Number),
  reset: Schema.optional(Schema.Boolean),
  sql: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
});
const decodeControlBody = Schema.decodeUnknownOption(Schema.fromJsonString(ControlBody));

async function requestBody(request: Request): Promise<typeof ControlBody.Type> {
  return Option.getOrElse(decodeControlBody(await request.text()), () => ({}));
}

const app = createWorkerHandler(async (request) => {
  const handler = routeHandler(new URL(request.url).pathname, request.method);
  return handler ? handler({ request }) : Response.json({ error: { code: "not_found" } }, { status: 404 });
});

async function control(request: Request, bindings: HarnessBindings, path: string): Promise<Response> {
  if (path === "/__e2e/clock") {
    const body = await requestBody(request);
    clockOffset = body.offsetMs ?? clockOffset;
    return Response.json({ offsetMs: clockOffset, now: Date.now() });
  }
  if (path === "/__e2e/count") {
    const body = await requestBody(request);
    return Response.json(counts(body.reset === true));
  }
  if (path === "/__e2e/sql") {
    const body = await requestBody(request);
    const sql = body.sql ?? "";
    const params = body.params ?? [];
    const result = await uncounted(() =>
      bindings.DB.prepare(sql)
        .bind(...params)
        .all(),
    );
    return Response.json(result.results);
  }
  if (path === "/__e2e/counter-check") {
    counts(true);
    await bindings.DB.prepare("SELECT 1").first();
    await bindings.DB.batch([bindings.DB.prepare("SELECT 2"), bindings.DB.prepare("SELECT 3")]);
    await bindings.DB.withSession("first-primary").prepare("SELECT 4").all();
    return Response.json(counts(true));
  }
  return Response.json({ error: { code: "not_found" } }, { status: 404 });
}

export default {
  async fetch(request: Request, bindings: HarnessBindings, context: ExecutionContext): Promise<Response> {
    patchDatabase(bindings.DB);
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__e2e/peer/") && bindings.PEER) {
      const target = new URL(url.pathname.slice("/__e2e/peer".length) + url.search, url.origin);
      return bindings.PEER.fetch(new Request(target, request));
    }
    if (url.pathname.startsWith("/__e2e/")) return control(request, bindings, url.pathname);
    return app.fetch(request, bindings, context);
  },
};
