// Runs device tools end to end on the real modules: the real `createDeviceToolService` and the real
// `routeDeviceTools` behind a real HTTP server. A fake phone transport stands in for the Team API
// event connections. Each case waits on an event or a promise, never on elapsed time. The timeout
// case starts a second service with a short deadline.
// `bun scripts/device-tools-e2e.ts`. Writes .openbot-build/device-tools/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import type { TeamMemberSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import {
  DEVICE_TOOLS_CAPABILITY,
  DEVICE_TOOLS_ROUTES,
  type DeviceToolOperation,
  type DeviceToolRequest,
  type DeviceToolRequestedEvent,
  type DeviceToolResolvedEvent,
  type DeviceToolRespondRequest,
  type DeviceToolResults,
} from "@openbot/contracts/team-protocol/device-tools-v1";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import {
  createDeviceToolService,
  type DeviceToolFailed,
  type DeviceToolServiceHandle,
  type DeviceToolTransport,
} from "../src/backend/device-tool-service";
import { HttpError } from "../src/main/team-api/http-error";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import { routeDeviceTools } from "../src/main/team-api/route-device-tools";

const OUT = resolve(import.meta.dirname, "../.openbot-build/device-tools");
const SECRET = "SECRET-SENTINEL-4f2a";

type DeviceEvent = DeviceToolRequestedEvent | DeviceToolResolvedEvent;

// Each phone is one event connection: a session of one member that declared the capability.
class FakePhones implements DeviceToolTransport {
  private readonly phones = new Map<string, { memberId: string; events: DeviceEvent[] }>();
  private readonly waiters: Array<{ sessionId: string; resolve: (event: DeviceToolRequestedEvent) => void }> = [];

  connect(sessionId: string, memberId: string): void {
    this.phones.set(sessionId, { memberId, events: [] });
  }
  hasDevice(memberId: string): boolean {
    return [...this.phones.values()].some((phone) => phone.memberId === memberId);
  }
  send(memberId: string, event: DeviceEvent, exceptSessionId?: string | null) {
    let delivered = 0;
    for (const [sessionId, phone] of this.phones) {
      if (phone.memberId !== memberId || sessionId === exceptSessionId) continue;
      phone.events.push(event);
      delivered += 1;
      if (event.type !== "device-tool-requested") continue;
      for (const waiter of this.waiters.filter((candidate) => candidate.sessionId === sessionId)) waiter.resolve(event);
    }
    return delivered;
  }
  eventsOf(sessionId: string): DeviceEvent[] {
    return this.phones.get(sessionId)?.events ?? [];
  }
  /** Resolves when the phone has a request: now if it holds one, else on delivery. */
  requested(sessionId: string, afterCount = 0): Promise<DeviceToolRequestedEvent> {
    const held = this.eventsOf(sessionId)
      .filter((event): event is DeviceToolRequestedEvent => event.type === "device-tool-requested")
      .at(afterCount);
    if (held) return Promise.resolve(held);
    return new Promise((resolveEvent) => {
      this.waiters.push({ sessionId, resolve: resolveEvent });
    });
  }
}

const member = (id: string): TeamMemberSummary => ({
  id,
  username: id,
  email: null,
  name: null,
  role: "member",
  createdAt: "2026-01-01T00:00:00Z",
  disabled: false,
});

interface Answer {
  status: number;
  code: string | null;
}

// The real route, behind a real HTTP server. The server stands in for the authenticated Team API shell.
async function startRoute(service: DeviceToolServiceHandle) {
  const server = createServer((request, response) => {
    const memberId = String(request.headers["x-test-member"] ?? "");
    const sessionId = String(request.headers["x-test-session"] ?? "");
    const send = (status: number, value: object | null) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value ?? {}));
      return "handled" as const;
    };
    const context: TeamApiRequestContext = {
      request,
      response,
      method: request.method ?? "GET",
      url: new URL(request.url ?? "/", "http://localhost"),
      protocol: 1,
      capabilities: new Set([DEVICE_TOOLS_CAPABILITY]),
      member: member(memberId),
      token: "test-token",
      sessionId,
      sessionExpiresAt: new Date(0).toISOString(),
      agentLevel: () => "manage",
      json: send,
      empty: (status: number) => send(status, null),
    };
    routeDeviceTools(context, service).then(
      (outcome) => {
        if (outcome === "unmatched") send(404, { error: "unmatched" });
      },
      (error: unknown) =>
        error instanceof HttpError ? send(error.status, { error: error.message }) : send(500, { error: "failed" }),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The route server has no port.");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    async answer(memberId: string, sessionId: string, body: DeviceToolRespondRequest): Promise<Answer> {
      const reply = await fetch(`${base}${DEVICE_TOOLS_ROUTES.respond}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-member": memberId, "x-test-session": sessionId },
        body: JSON.stringify(body),
      });
      const parsed = JSON.parse(await reply.text());
      return { status: reply.status, code: isDynamicRecord(parsed) && isString(parsed.code) ? parsed.code : null };
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

type CallResult = { ok: true; value: unknown } | { ok: false; code: string };
const run = (service: DeviceToolServiceHandle, memberId: string, request: DeviceToolRequest, turnId = "turn-1") =>
  Effect.runPromise(
    service.call({ memberId, agentId: "agent-1", turnId, request }).pipe(
      Effect.map((value): CallResult => ({ ok: true, value })),
      Effect.catch((failure: DeviceToolFailed) => Effect.succeed<CallResult>({ ok: false, code: failure.code })),
    ),
  );

const LOCATION: DeviceToolRequest = { app: "location", operation: "location.current", args: {} };
const REMINDER_ADD: DeviceToolRequest = {
  app: "reminders",
  operation: "reminders.add",
  args: { title: `Buy ${SECRET}` },
};
const FIND: DeviceToolRequest = {
  app: "contacts",
  operation: "contacts.find",
  args: { query: SECRET, limit: 3 },
};

const report: { startedAt: string; cases: Array<{ name: string; passed: boolean; detail?: string }> } = {
  startedAt: new Date().toISOString(),
  cases: [],
};
const logLines: string[] = [];

async function runCase(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    report.cases.push({ name, passed: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    report.cases.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    process.stdout.write(`FAIL ${name}\n`);
  }
}

async function main() {
  const stopTee = teeLogLines(["device-tool-service"], (line) => logLines.push(line));
  const phones = new FakePhones();
  phones.connect("phone-a", "member-a");
  phones.connect("phone-b1", "member-b");
  phones.connect("phone-b2", "member-b");
  let counter = 0;
  const service = await Effect.runPromise(
    createDeviceToolService({ transport: () => phones, newRequestId: () => `req-${++counter}` }),
  );
  const route = await startRoute(service);

  await runCase("allow: result decoded per operation", async () => {
    const results: Array<[DeviceToolRequest, DeviceToolResults[DeviceToolOperation]]> = [
      [LOCATION, { latitude: 1.5, longitude: 2.5, accuracy: 10, timestamp: "2026-01-01T00:00:00Z" }],
      [REMINDER_ADD, { id: "r1" }],
      [FIND, { contacts: [{ id: "c1", name: "Ann", phones: ["1"], emails: [] }] }],
    ];
    for (const [request, result] of results) {
      const seen = phones.eventsOf("phone-a").length;
      const pending = run(service, "member-a", request);
      const event = await phones.requested("phone-a", seen);
      assert.equal(event.operation, request.operation);
      const reply = await route.answer("member-a", "phone-a", { requestId: event.requestId, ok: true, result });
      assert.equal(reply.status, 200);
      assert.deepEqual(await pending, { ok: true, value: result });
    }
  });

  await runCase("deny: app_not_allowed", async () => {
    const seen = phones.eventsOf("phone-a").length;
    const pending = run(service, "member-a", LOCATION);
    const event = await phones.requested("phone-a", seen);
    const reply = await route.answer("member-a", "phone-a", {
      requestId: event.requestId,
      ok: false,
      code: "app_not_allowed",
    });
    assert.equal(reply.status, 200);
    assert.deepEqual(await pending, { ok: false, code: "app_not_allowed" });
  });

  await runCase("timeout: device_timeout, then the late answer gets 409", async () => {
    const shortPhones = new FakePhones();
    shortPhones.connect("phone-t", "member-t");
    const short = await Effect.runPromise(
      createDeviceToolService({ transport: () => shortPhones, deadlineMs: 20, newRequestId: () => "req-timeout" }),
    );
    const shortRoute = await startRoute(short);
    try {
      assert.deepEqual(await run(short, "member-t", LOCATION), { ok: false, code: "device_timeout" });
      assert.equal(shortPhones.eventsOf("phone-t").at(-1)?.type, "device-tool-resolved");
      const late = await shortRoute.answer("member-t", "phone-t", {
        requestId: "req-timeout",
        ok: false,
        code: "device_error",
      });
      assert.equal(late.status, 409);
    } finally {
      await shortRoute.close();
      await Effect.runPromise(short.close());
    }
  });

  await runCase("wrong member answer: 403, request stays open", async () => {
    const seen = phones.eventsOf("phone-a").length;
    const pending = run(service, "member-a", LOCATION);
    const event = await phones.requested("phone-a", seen);
    const forged = await route.answer("member-b", "phone-b1", {
      requestId: event.requestId,
      ok: false,
      code: "device_error",
    });
    assert.equal(forged.status, 403);
    const owner = await route.answer("member-a", "phone-a", {
      requestId: event.requestId,
      ok: false,
      code: "os_permission_denied",
    });
    assert.equal(owner.status, 200);
    assert.deepEqual(await pending, { ok: false, code: "os_permission_denied" });
  });

  await runCase("late or unknown answer: 409 device_request_closed", async () => {
    const unknown = await route.answer("member-a", "phone-a", {
      requestId: "req-none",
      ok: false,
      code: "device_error",
    });
    assert.equal(unknown.status, 409);
    assert.equal(unknown.code, "device_request_closed");
    const seen = phones.eventsOf("phone-a").length;
    const pending = run(service, "member-a", LOCATION);
    const event = await phones.requested("phone-a", seen);
    await route.answer("member-a", "phone-a", { requestId: event.requestId, ok: false, code: "device_error" });
    await pending;
    const late = await route.answer("member-a", "phone-a", {
      requestId: event.requestId,
      ok: false,
      code: "device_error",
    });
    assert.equal(late.status, 409);
    assert.equal(late.code, "device_request_closed");
  });

  await runCase("two phones: first wins, the other gets device-tool-resolved", async () => {
    const pending = run(service, "member-b", LOCATION);
    const [first, second] = await Promise.all([phones.requested("phone-b1"), phones.requested("phone-b2")]);
    assert.equal(first.requestId, second.requestId);
    const win = await route.answer("member-b", "phone-b1", {
      requestId: first.requestId,
      ok: true,
      result: { latitude: 1, longitude: 2, accuracy: 3, timestamp: "2026-01-01T00:00:00Z" },
    });
    assert.equal(win.status, 200);
    assert.equal((await pending).ok, true);
    const loser = phones.eventsOf("phone-b2").filter((event) => event.requestId === first.requestId);
    assert.deepEqual(
      loser.map((event) => event.type),
      ["device-tool-requested", "device-tool-resolved"],
    );
    const winner = phones.eventsOf("phone-b1").filter((event) => event.requestId === first.requestId);
    assert.deepEqual(
      winner.map((event) => event.type),
      ["device-tool-requested"],
    );
    const slow = await route.answer("member-b", "phone-b2", {
      requestId: first.requestId,
      ok: false,
      code: "app_not_allowed",
    });
    assert.equal(slow.status, 409);
  });

  await runCase("no phone: device_unavailable", async () => {
    assert.equal(service.available("member-none"), false);
    assert.deepEqual(await run(service, "member-none", LOCATION), { ok: false, code: "device_unavailable" });
  });

  await runCase("result that mismatches the operation: device_error", async () => {
    const seen = phones.eventsOf("phone-a").length;
    const pending = run(service, "member-a", REMINDER_ADD);
    const event = await phones.requested("phone-a", seen);
    const reply = await route.answer("member-a", "phone-a", {
      requestId: event.requestId,
      ok: true,
      result: { latitude: 1, longitude: 2, accuracy: 3, timestamp: "2026-01-01T00:00:00Z" },
    });
    assert.equal(reply.status, 400);
    assert.deepEqual(await pending, { ok: false, code: "device_error" });
  });

  await runCase("redaction: log lines hold no arguments or results", async () => {
    assert.ok(logLines.length > 0, "the service wrote no log line");
    for (const line of logLines) {
      assert.ok(!line.includes(SECRET), "a log line holds an argument");
      assert.ok(!line.includes("latitude"), "a log line holds a result");
      assert.ok(!line.includes("Ann"), "a log line holds a result");
    }
  });

  stopTee();
  await route.close();
  await Effect.runPromise(service.close());
  const failed = report.cases.filter((entry) => !entry.passed);
  await mkdir(OUT, { recursive: true });
  await writeFile(
    resolve(OUT, "report.json"),
    `${JSON.stringify({ ...report, finishedAt: new Date().toISOString(), failed: failed.length }, null, 2)}\n`,
  );
  for (const entry of failed) process.stderr.write(`${entry.name}: ${entry.detail}\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
