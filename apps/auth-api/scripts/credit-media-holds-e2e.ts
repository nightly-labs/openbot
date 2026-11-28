import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Effect, Exit } from "effect";
import { CreditMediaService } from "../src/server/credit-media-service";
import { CreditSpending } from "../src/server/credit-spending";
import { type MediaGateway, MediaGatewayError } from "../src/server/media-gateway";
import { migratedDatabase } from "../test/sqlite-d1";
import { sqliteD1 } from "./sqlite-d1";

const OUT = resolve(import.meta.dirname, "../../../.openbot-build/credit-media-holds-e2e");
const MINUTE = 60_000;
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
const SPECS = {
  aspects: ["9:16"],
  defaultAspect: "9:16",
  resolutions: ["1080p"],
  defaultResolution: "1080p",
  durations: [10],
  defaultDuration: 10,
  frames: 0,
  references: 3,
  audio: false,
  maxCount: 1,
  promptRequired: true,
};

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

interface Rig {
  sqlite: DatabaseSync;
  service: CreditMediaService;
  spending: CreditSpending;
  processor: { submits: number; doneAt: number; refuseSubmits: number };
  clock: { now: number };
}

function failSaves(rig: Rig, failing: boolean) {
  rig.sqlite.exec(
    failing
      ? `CREATE TEMP TRIGGER fail_save BEFORE UPDATE OF provider_job_id ON credit_holds
           WHEN NEW.provider_job_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'D1_ERROR: Network connection lost.'); END`
      : "DROP TRIGGER fail_save",
  );
}

function rig(credits: number): Rig {
  const sqlite = migratedDatabase();
  sqlite.exec(`
    INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
    VALUES ('user-1', 'email:user-1@example.test', 'user-1@example.test', 'Ana', NULL, 1, 1);
    INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
    VALUES ('purchase:1', 'user-1', NULL, ${credits * 10}, 'purchase', 'user-1', 'cs_1', 1);
    INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, enabled, specs, updated_at)
    VALUES ('magi-2', 'magi-2', 'video', 'MAGI-2', 'Sand AI', 1, '${JSON.stringify(SPECS)}', 1);
    INSERT INTO credit_media_prices(model_id, resolution, unit, credits, updated_at)
    VALUES ('magi-2', '1080p', 'second', 2.2, 1);
  `);
  const clock = { now: 1_000_000_000_000 };
  const processor = { submits: 0, doneAt: Number.POSITIVE_INFINITY, refuseSubmits: 0 };
  const state = (id: string) => ({
    upstream: "router",
    id,
    status: clock.now >= processor.doneAt ? ("completed" as const) : ("processing" as const),
    pollAfterSeconds: 5,
    failure: null,
  });
  const gateway: MediaGateway = {
    models: () => Effect.succeed([{ id: "magi-2", upstream: "router", specs: {}, welcomeUpstream: null }]),
    submit: () =>
      Effect.suspend(() => {
        if (processor.refuseSubmits > 0) {
          processor.refuseSubmits -= 1;
          return Effect.fail(new MediaGatewayError({ status: 503, code: "busy", retryAfterSeconds: null }));
        }
        processor.submits += 1;
        return Effect.succeed({ ...state(`processor-${processor.submits}`), status: "queued" as const });
      }),
    status: (_upstream, id) => Effect.sync(() => state(id)),
    result: () =>
      Effect.sync(() =>
        clock.now >= processor.doneAt ? [{ mimeType: "video/mp4", width: 1080, height: 1920, durationMs: 10_000 }] : [],
      ),
    output: () => Effect.sync(() => new Response(MP4, { headers: { "Content-Length": String(MP4.byteLength) } })),
  };
  const database = sqliteD1(sqlite);
  const now = () => clock.now;
  return {
    sqlite,
    service: new CreditMediaService({ database, gateway, now }),
    spending: new CreditSpending({ database, now }),
    processor,
    clock,
  };
}

const PAYER = { wallet: "personal" as const, userId: "user-1" };

function balance(rig: Rig): number {
  const row = rig.sqlite
    .prepare(
      `SELECT (SELECT COALESCE(SUM(amount_tenths), 0) FROM credit_ledger WHERE user_id = 'user-1')
        - (SELECT COALESCE(SUM(credits_tenths), 0) FROM credit_holds WHERE user_id = 'user-1' AND status = 'held') AS t`,
    )
    .get();
  return Number(row?.t) / 10;
}

function holds(rig: Rig) {
  return rig.sqlite
    .prepare("SELECT job_id, status, outcome, provider_job_id FROM credit_holds ORDER BY created_at, job_id")
    .all()
    .map((row) => ({
      jobId: String(row.job_id),
      status: String(row.status),
      outcome: row.outcome === null ? null : String(row.outcome),
      providerJobId: row.providerJobId === null ? null : String(row.provider_job_id),
    }));
}

function submission(jobId: string) {
  return {
    request: {
      jobId,
      model: "magi-2",
      prompt: "A cat on a boat",
      aspect: "9:16",
      resolution: "1080p",
      duration: 10,
      count: 1,
      audio: false,
    },
    inputs: [],
  };
}

async function sweepAt(rig: Rig, minutes: number, from: number) {
  rig.clock.now = from + minutes * MINUTE;
  await Effect.runPromise(rig.service.sweep());
}

async function serverChecks() {
  const failedSave = rig(155);
  const started = failedSave.clock.now;
  failSaves(failedSave, true);
  const first = await Effect.runPromiseExit(failedSave.service.submit(PAYER, "user-1", submission("job-a")));
  failSaves(failedSave, false);
  await sweepAt(failedSave, 11, started);
  const afterSweep = holds(failedSave)[0];
  check(
    "a hold whose processor job could not be saved goes back to the balance at the next sweep after its lease and 10 minutes, not after 24 hours",
    Exit.isFailure(first) &&
      afterSweep?.status === "released" &&
      afterSweep.outcome === "abandoned" &&
      balance(failedSave) === 155,
    { hold: afterSweep, balance: balance(failedSave) },
  );
  const resent = await Effect.runPromise(failedSave.service.submit(PAYER, "user-1", submission("job-a")));
  check(
    "a client that sends the released job again gets a failed job with no charge, not a new processor job",
    resent.status === "failed" && resent.credits === 0 && failedSave.processor.submits === 1,
    { resent, submits: failedSave.processor.submits },
  );
  const saved = await Effect.runPromise(failedSave.spending.start("job-a", "processor-late"));
  check(
    "a late save of the processor job keeps the released hold released, with the late job id for a cancel",
    saved?.status === "released" && saved.providerJobId === "processor-late" && balance(failedSave) === 155,
    saved,
  );

  const busy = rig(155);
  const busyStart = busy.clock.now;
  busy.processor.refuseSubmits = 1;
  await Effect.runPromiseExit(busy.service.submit(PAYER, "user-1", submission("job-b")));
  await sweepAt(busy, 11, busyStart);
  check(
    "a hold left by a busy processor answer goes back to the balance at the next sweep",
    holds(busy)[0]?.status === "released" && balance(busy) === 155,
    { holds: holds(busy), balance: balance(busy) },
  );

  const leased = rig(155);
  const leasedStart = leased.clock.now;
  failSaves(leased, true);
  await Effect.runPromiseExit(leased.service.submit(PAYER, "user-1", submission("job-c")));
  failSaves(leased, false);
  leased.sqlite
    .prepare("UPDATE credit_holds SET submit_lease_until = ? WHERE job_id = 'job-c'")
    .run(leasedStart + 13 * MINUTE);
  await sweepAt(leased, 11, leasedStart);
  check(
    "the sweep keeps a hold while a new submit of the same job holds its lease",
    holds(leased)[0]?.status === "held" && balance(leased) === 133,
    { holds: holds(leased), balance: balance(leased) },
  );

  const running = rig(155);
  const runningStart = running.clock.now;
  await Effect.runPromise(running.service.submit(PAYER, "user-1", submission("job-d")));
  await sweepAt(running, 11, runningStart);
  check(
    "the sweep keeps a hold whose processor job runs",
    holds(running)[0]?.status === "held" && holds(running)[0]?.providerJobId === "processor-1",
    holds(running),
  );
}

let passed = false;
try {
  await serverChecks();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} ${item.name}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
if (!passed) process.exit(1);
