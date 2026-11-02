// The real account service over a SQLite database file, for `scripts/mobile-connected-devices-e2e.ts`.
// It serves only the routes that the check uses, with the request handling of the Worker routes, and
// writes `{"port":<port>}` on one line when it listens. Development codes come back in the answers.
//
// Run: bun apps/auth-api/scripts/mobile-connected-devices-server.ts <database path>
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { isMobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { AuthService, AuthServiceError } from "../src/server/auth-service";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { sqliteD1 } from "./sqlite-d1";

const SOURCE_IP = "127.0.0.1";
const databasePath = process.argv[2];
if (!databasePath) throw new Error("Pass the database path.");
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA foreign_keys = ON");
const service = new AuthService({
  repository: new D1AuthRepository(sqliteD1(database)),
  delivery: null,
  exposeDevelopmentCode: true,
});

interface Answer {
  status: number;
  body?: unknown;
}

function failure(status: number, code: string, message: string): Answer {
  return { status, body: { error: { code, message } } };
}

function recordOf(value: unknown): DynamicRecord {
  return isDynamicRecord(value) ? value : {};
}

function readBody(request: IncomingMessage): Promise<DynamicRecord> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(chunks.length ? recordOf(JSON.parse(Buffer.concat(chunks).toString("utf8"))) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function route(request: IncomingMessage, body: DynamicRecord) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const token = /^Bearer (\S+)$/u.exec(request.headers.authorization ?? "")?.[1] ?? null;
  const key = `${request.method} ${url.pathname}`;
  return Effect.gen(function* (): Effect.fn.Return<Answer, unknown> {
    if (key === "GET /health/live") return { status: 200, body: { status: "ok" } };
    if (key === "POST /v1/auth/email/start") {
      if (!isString(body.email)) return failure(400, "invalid_email", "Enter a valid email address.");
      const idempotencyKey = request.headers["idempotency-key"];
      return {
        status: 200,
        body: yield* service.startEmailSignIn(
          body.email,
          SOURCE_IP,
          isString(idempotencyKey) ? idempotencyKey : undefined,
        ),
      };
    }
    if (key === "POST /v1/auth/email/verify") {
      if (!isString(body.challengeId) || !isString(body.code)) {
        return failure(400, "invalid_sign_in_code", "The sign-in code is invalid.");
      }
      return {
        status: 200,
        body: yield* service.verifyEmailCode({
          challengeId: body.challengeId,
          code: body.code,
          sourceIp: SOURCE_IP,
          surface: "desktop",
        }),
      };
    }
    if (key === "POST /v1/mobile-auth/redeem") {
      if (
        !isString(body.ticket) ||
        !isString(body.deviceId) ||
        !isString(body.deviceName) ||
        (body.platform !== "ios" && body.platform !== "android" && body.platform !== "unknown")
      ) {
        return failure(400, "invalid_mobile_ticket", "The Mobile Connect code is invalid.");
      }
      const session = yield* service.redeemMobileAuthTicket(
        body.ticket,
        { id: body.deviceId, name: body.deviceName, platform: body.platform },
        SOURCE_IP,
      );
      return session
        ? { status: 200, body: session }
        : failure(401, "invalid_mobile_ticket", "The Mobile Connect code is invalid or expired.");
    }
    if (!token) return failure(401, "unauthorized", "Sign in is required.");
    if (key === "GET /v1/me") {
      const user = yield* service.authenticate(token);
      return user ? { status: 200, body: user } : failure(401, "unauthorized", "The session is invalid.");
    }
    if (key === "POST /v1/mobile-auth/ticket") {
      // The Worker route also asks the remote control plane to check the host. The redeem checks the
      // same binding against the directory row, so this check leaves it out.
      if (!isMobileConnectHostBinding(body.host)) {
        return failure(
          400,
          "invalid_mobile_host",
          "Update the desktop app to create a host-bound Mobile Connect code.",
        );
      }
      return { status: 200, body: yield* service.issueMobileAuthTicket(token, SOURCE_IP, body.host) };
    }
    if (key === "GET /v1/mobile-auth/devices") {
      return {
        status: 200,
        body: { devices: yield* service.listMobileAuthDevices(token, url.searchParams.get("host")) },
      };
    }
    const revoke = /^DELETE \/v1\/mobile-auth\/devices\/([^/]+)$/u.exec(key);
    if (revoke?.[1]) {
      yield* service.revokeMobileAuthDevice(token, decodeURIComponent(revoke[1]));
      return { status: 204 };
    }
    return failure(404, "not_found", "Not found.");
  }).pipe(
    Effect.catchIf(
      (error) => error instanceof AuthServiceError,
      (error) => Effect.succeed(failure(error.status, error.code, error.message)),
    ),
  );
}

function send(response: ServerResponse, answer: Answer) {
  response.writeHead(answer.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(answer.body === undefined ? undefined : JSON.stringify(answer.body));
}

const server = createServer((request, response) => {
  readBody(request)
    .then((body) => Effect.runPromise(route(request, body)))
    .then(
      (answer) => send(response, answer),
      () => send(response, failure(500, "internal_error", "Internal error.")),
    );
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("The account server has no port.");
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});
process.on("SIGTERM", () => {
  server.close();
  database.close();
  process.exit(0);
});
