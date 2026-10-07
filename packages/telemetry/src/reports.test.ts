import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Semaphore } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFailure, type FailureProperties, type Report, safeProperties, safeReport } from "./events";
import { fileReportStorage } from "./node";
import {
  REPORT_BYTES,
  REPORT_LIMIT,
  REPORT_TTL,
  ReportQueue,
  type ReportStorage,
  TelemetryFailure,
  telemetryIO,
} from "./queue";
import { openPanelTransport } from "./transport";

const properties: FailureProperties = {
  operation: "turn",
  source: "provider",
  severity: "error",
  cause_code: "invalid_upload_request",
  provider: "codex",
  model: "gpt-6",
};
const context = {
  surface: "desktop_host",
  platform: "darwin",
  app_version: "0.31.0",
  event_schema_version: 7,
} as const;
const queues: ReportQueue[] = [];
afterEach(async () => {
  for (const queue of queues.splice(0)) await Effect.runPromise(queue.close());
  vi.useRealTimers();
});
function memoryStorage(initial: unknown = null) {
  let value = initial;
  return {
    read: () => Effect.succeed(value),
    write: (next: unknown) =>
      Effect.sync(() => {
        value = structuredClone(next);
      }),
    value: () => value,
  };
}
function queue(storage: ReportStorage, send: ConstructorParameters<typeof ReportQueue>[1], now = Date.now) {
  const value = new ReportQueue(storage, send, context, now, () => 1);
  queues.push(value);
  return value;
}
function report(extra: Partial<Report> = {}): Report {
  return {
    ...context,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    profileId: "account-1",
    name: "system_operation_failed",
    properties,
    ...extra,
  };
}

describe("safe failure reports", () => {
  it("classifies both providers and uses structured codes before message text", () => {
    expect(classifyFailure("Internal error: Invalid upload request.")).toBe("invalid_upload_request");
    expect(classifyFailure("Upstream request failed: [invalid_request_error] Invalid upload request.")).toBe(
      "invalid_upload_request",
    );
    expect(classifyFailure({ code: "rate_limit_exceeded", message: "Invalid upload request." })).toBe("rate_limit");
    expect(classifyFailure({ error: { codexErrorInfo: "usageLimitExceeded" } })).toBe("usage_limit");
    expect(classifyFailure("secret text from a provider")).toBe("unknown");
  });

  it("drops private fields before persistence and rejects unsafe account identifiers", () => {
    const safe = safeReport({
      ...report(),
      message: "secret-prompt",
      properties: {
        ...properties,
        path: "/Users/private",
        token: "private-key",
        prompt: "secret-prompt",
        failure_code: "private-text",
      },
    });
    expect(safe?.properties.failure_code).toBe("unknown");
    expect(JSON.stringify(safe)).not.toMatch(/secret-prompt|private-key|Users|private-text/);
    expect(safeReport({ ...report(), profileId: "Bearer private-token\n" })).toBeNull();
    expect(safeProperties({ ...properties, provider: "acp", model: "private-company" })?.model).toBeUndefined();
    expect(safeProperties({ ...properties, model: "sk-private-token" })?.model).toBe("custom");
    expect(safeProperties({ ...properties, provider: "opencode", model: "private-company/gpt" })?.model).toBe("custom");
  });

  it("persists a refused HTTP report, sends it after restart, and writes a transport artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-reports-"));
    const path = join(root, "reports.json");
    const bodies: unknown[] = [];
    let status = 503;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(status).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test listener.");
    const transport = openPanelTransport({
      clientId: "test-client",
      endpoint: `http://127.0.0.1:${address.port}/track`,
    });
    try {
      const first = queue(fileReportStorage(path), transport);
      await Effect.runPromise(first.configure(true, "account-1"));
      await Effect.runPromise(first.record("system_operation_failed", properties));
      const saved = JSON.parse(await readFile(path, "utf8"));
      expect(saved.reports).toHaveLength(1);
      await Effect.runPromise(first.close());
      status = 202;
      const restored = queue(fileReportStorage(path), transport);
      await Effect.runPromise(restored.configure(true, "account-1"));
      expect(JSON.parse(await readFile(path, "utf8")).reports).toEqual([]);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[1]).toMatchObject({
        type: "track",
        payload: {
          name: "system_operation_failed",
          profileId: "account-1",
          properties: { provider: "codex", cause_code: "invalid_upload_request", __path: "", __referrer: "" },
        },
      });
      await mkdir(".openbot-build/telemetry", { recursive: true });
      await writeFile(
        ".openbot-build/telemetry/transport.json",
        JSON.stringify({ passed: true, attempts: bodies, persistedAfterDelivery: 0 }, null, 2),
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("aborts on opt-out and rejects old scopes after re-enable or account change", async () => {
    const storage = memoryStorage();
    const sent: Report[] = [];
    let started: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    const instance = queue(storage, (value, signal) =>
      telemetryIO(
        () =>
          new Promise<boolean>((resolve) => {
            sent.push(value);
            started();
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve(false);
              },
              { once: true },
            );
          }),
      ),
    );
    await Effect.runPromise(instance.configure(true, "account-1"));
    const scope = instance.scope();
    const sending = Effect.runPromise(scope.record("system_operation_failed", properties));
    await arrived;
    await Effect.runPromise(instance.configure(false, "account-1"));
    await sending;
    expect(aborted).toBe(true);
    expect(storage.value()).toMatchObject({ reports: [] });
    await Effect.runPromise(instance.configure(true, "account-2"));
    await Effect.runPromise(scope.record("system_operation_failed", properties));
    expect(sent).toHaveLength(1);
  });

  it("keeps anonymous identity and discards reports from a different stored account", async () => {
    const sent: Report[] = [];
    const stored = memoryStorage({
      version: 1,
      profileId: "old-account",
      reports: [report({ profileId: "old-account" })],
    });
    const instance = queue(stored, (value) =>
      Effect.sync(() => {
        sent.push(value);
        return true;
      }),
    );
    await Effect.runPromise(instance.configure(true, null));
    await Effect.runPromise(instance.record("notification_shown", { ...properties, presentation: "toast" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.profileId).toBeNull();
  });

  it("does not send until a failed storage write succeeds", async () => {
    const storage = memoryStorage();
    let failing = true;
    const sent = vi.fn(() => Effect.succeed(true));
    const instance = queue(
      { read: storage.read, write: (value) => (failing ? Effect.fail(new TelemetryFailure()) : storage.write(value)) },
      sent,
    );
    await Effect.runPromise(instance.configure(true, "account-1"));
    await Effect.runPromise(instance.record("system_operation_failed", properties));
    expect(sent).not.toHaveBeenCalled();
    failing = false;
    await Effect.runPromise(instance.flush());
    expect(sent).toHaveBeenCalledOnce();
    expect(storage.value()).toMatchObject({ reports: [] });
  });

  it("keeps new reports after a failed consent clear and bounds failed writes", async () => {
    const storage = memoryStorage({
      version: 1,
      profileId: "old-account",
      reports: [report({ profileId: "old-account" })],
    });
    let failing = true;
    const instance = queue(
      {
        read: storage.read,
        write: (value) => (failing ? Effect.fail(new TelemetryFailure()) : storage.write(value)),
      },
      () => Effect.succeed(false),
    );
    await Effect.runPromise(instance.configure(false, "old-account"));
    await Effect.runPromise(instance.configure(true, "new-account"));
    for (let index = 0; index < REPORT_LIMIT + 2; index++) {
      await Effect.runPromise(instance.record("system_operation_failed", properties));
    }
    failing = false;
    await Effect.runPromise(instance.flush());
    const saved = JSON.stringify(storage.value());
    expect(saved).not.toContain("old-account");
    expect(saved.match(/"timestamp"/gu)).toHaveLength(REPORT_LIMIT);
  });

  it("keeps pre-consent reports anonymous and clears them when consent is refused", async () => {
    for (const [enabled, accountId, count] of [
      [true, null, 1],
      [false, null, 0],
      [true, "signed-in", 0],
    ] as const) {
      const sent: Report[] = [];
      const instance = queue(memoryStorage(), (value) =>
        Effect.sync(() => {
          sent.push(value);
          return true;
        }),
      );
      await Effect.runPromise(instance.record("notification_shown", properties));
      expect(sent).toEqual([]);
      await Effect.runPromise(instance.configure(enabled, accountId));
      expect(sent).toHaveLength(count);
      if (count) expect(sent[0]?.profileId).toBeNull();
    }
  });

  it("persists an accepted record before shutdown closes its pending write", async () => {
    const storage = memoryStorage();
    const instance = queue(storage, () => Effect.succeed(false));
    await Effect.runPromise(instance.configure(true, "account-1"));
    const writing = Effect.runPromise(instance.record("system_operation_failed", properties));
    await Effect.runPromise(instance.close());
    await writing;
    expect(storage.value()).toMatchObject({ reports: [expect.objectContaining({ properties })] });
  });

  it("shares a storage lock across clients without overwriting reports", async () => {
    const lock = Semaphore.makeUnsafe(1);
    const storage = memoryStorage();
    const shared: ReportStorage = {
      ...storage,
      acquire: () =>
        lock.take(1).pipe(
          Effect.as(() => {
            Effect.runSync(lock.release(1));
          }),
        ),
    };
    const first = queue(shared, () => Effect.succeed(false));
    const second = queue(shared, () => Effect.succeed(false));
    await Effect.runPromise(first.configure(true, "account-1"));
    await Effect.runPromise(second.configure(true, "account-1"));
    await Promise.all([
      Effect.runPromise(first.record("system_operation_failed", properties)),
      Effect.runPromise(second.record("system_operation_failed", { ...properties, provider: "opencode" })),
    ]);
    const value = await Effect.runPromise(storage.read());
    expect(value).toMatchObject({
      reports: expect.arrayContaining([
        expect.objectContaining({ properties: expect.objectContaining({ provider: "codex" }) }),
        expect.objectContaining({ properties: expect.objectContaining({ provider: "opencode" }) }),
      ]),
    });
  });

  it("caps restored reports, expires old entries, and ignores corrupt storage", async () => {
    const now = Date.now();
    const reports = Array.from({ length: REPORT_LIMIT + 10 }, () => report());
    reports.push(report({ timestamp: new Date(now - REPORT_TTL - 1).toISOString() }));
    const storage = memoryStorage({ version: 1, profileId: "account-1", reports });
    const instance = queue(
      storage,
      () => Effect.succeed(false),
      () => now + 1_000,
    );
    await Effect.runPromise(instance.configure(true, "account-1"));
    expect(storage.value()).toMatchObject({ reports: expect.any(Array) });
    const saved = await Effect.runPromise(storage.read());
    expect(JSON.stringify(saved).match(/"timestamp"/gu)).toHaveLength(REPORT_LIMIT);
    const broken = queue(memoryStorage("corrupt"), () => Effect.succeed(true));
    await Effect.runPromise(broken.configure(true, "account-1"));
    await Effect.runPromise(broken.record("system_operation_failed", properties));
  });

  it("bounds stored bytes and drops the oldest report first", async () => {
    const older = report({
      app_version: `0.31.0-${"a".repeat(600_000)}`,
      timestamp: new Date(Date.now() - 1_000).toISOString(),
    });
    const newer = report({ app_version: older.app_version });
    const storage = memoryStorage({ version: 1, profileId: "account-1", reports: [older, newer] });
    const instance = queue(storage, () => Effect.succeed(false));
    await Effect.runPromise(instance.configure(true, "account-1"));
    expect(storage.value()).toMatchObject({ reports: [expect.objectContaining({ id: newer.id })] });
    expect(new TextEncoder().encode(JSON.stringify(storage.value())).byteLength).toBeLessThanOrEqual(REPORT_BYTES);
  });

  it("ends a hung request at its deadline and keeps the report", async () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    let arrived: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let aborted = false;
    const instance = queue(storage, (_value, signal) =>
      telemetryIO(() => {
        arrived();
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        return new Promise<boolean>(() => {});
      }),
    );
    await Effect.runPromise(instance.configure(true, "account-1"));
    const sending = Effect.runPromise(instance.record("system_operation_failed", properties));
    await started;
    await vi.advanceTimersByTimeAsync(10_000);
    await sending;
    expect(aborted).toBe(true);
    expect(storage.value()).toMatchObject({ reports: [expect.objectContaining({ properties })] });
  });

  it("uses a bounded backoff and lets a later report pass a rejected report", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    let accept = false;
    const instance = queue(memoryStorage(), (value) =>
      Effect.sync(() => {
        sent.push(value.properties.provider ?? "unknown");
        return accept && value.properties.provider === "opencode";
      }),
    );
    await Effect.runPromise(instance.configure(true, "account-1"));
    await Effect.runPromise(instance.record("system_operation_failed", properties));
    await Effect.runPromise(instance.record("system_operation_failed", { ...properties, provider: "opencode" }));
    expect(sent).toEqual(["codex"]);
    accept = true;
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(sent).toContain("opencode"));
  });
});
