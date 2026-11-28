import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CreditMediaJob, CreditMediaModel } from "@openbot/contracts/credit-media";
import { Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import { CreditMediaTools } from "../src/backend/agent/credit-media-tools";
import type { DynamicToolResult } from "../src/backend/protocol";
import {
  type CreditMediaGateway,
  CreditMediaGatewayFailed,
  CreditMediaWorkflows,
} from "../src/backend/workflows/credit-media";

const OUT = resolve(import.meta.dirname, "../.openbot-build/credit-media-hold-recovery-e2e");
const MINUTE = 60_000;
const LEASE_MS = 3 * MINUTE;
const PRICE = 22;
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VIDEO_ARGS = { prompt: "A cat on a boat", model: "magi-2", aspect: "9:16", resolution: "1080p", duration: 10 };
const MODEL: CreditMediaModel = {
  id: "magi-2",
  kind: "video",
  name: "MAGI-2",
  maker: "Sand AI",
  variant: null,
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
  prices: [{ resolution: "1080p", unit: "second", credits: 2.2, silentCredits: null }],
};

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

interface Hold {
  status: "held" | "charged" | "released";
  providerJobId: string | null;
  leaseUntil: number;
}

interface Account {
  now: number;
  credits: number;
  holds: Map<string, Hold>;
  processorSubmits: number;
  doneAt: number;
  failSaves: number;
  failPolls: number;
  pollsDown: boolean;
}

function account(credits: number): Account {
  return {
    now: 1_000_000_000_000,
    credits,
    holds: new Map(),
    processorSubmits: 0,
    doneAt: Number.POSITIVE_INFINITY,
    failSaves: 0,
    failPolls: 0,
    pollsDown: false,
  };
}

const available = (state: Account) =>
  state.credits - [...state.holds.values()].filter((hold) => hold.status !== "released").length * PRICE;

const internal = () =>
  new CreditMediaGatewayFailed({
    message: "The account service could not complete the request.",
    status: 500,
    code: "internal_error",
  });

function view(jobId: string, hold: Hold, status: CreditMediaJob["status"]): CreditMediaJob {
  return {
    jobId,
    model: MODEL.id,
    status,
    credits: hold.status === "released" ? 0 : PRICE,
    pollAfterSeconds: 5,
    outputs:
      status === "completed"
        ? [{ index: 0, mimeType: "video/mp4", width: 1080, height: 1920, durationMs: 10_000 }]
        : [],
    failure: hold.status === "released" ? "failed" : null,
    reason: null,
  };
}

function gateway(state: Account): CreditMediaGateway {
  const job = (jobId: string) =>
    Effect.suspend(() => {
      if (state.pollsDown) return Effect.fail(internal());
      if (state.failPolls > 0) {
        state.failPolls -= 1;
        return Effect.fail(internal());
      }
      const hold = state.holds.get(jobId);
      if (!hold)
        return Effect.fail(
          new CreditMediaGatewayFailed({ message: "Not found.", status: 404, code: "media_job_not_found" }),
        );
      if (hold.status === "released") return Effect.succeed(view(jobId, hold, "failed"));
      if (!hold.providerJobId) return Effect.succeed(view(jobId, hold, "queued"));
      if (state.now < state.doneAt) return Effect.succeed(view(jobId, hold, "processing"));
      hold.status = "charged";
      return Effect.succeed(view(jobId, hold, "completed"));
    });
  return {
    available: () => true,
    catalog: () => Effect.succeed({ models: [MODEL] }),
    balance: () => Effect.sync(() => ({ wallet: "personal" as const, available: available(state) })),
    submit: (request) =>
      Effect.suspend(() => {
        let hold = state.holds.get(request.jobId);
        if (!hold) {
          if (available(state) < PRICE)
            return Effect.fail(
              new CreditMediaGatewayFailed({
                message: "Not enough credits.",
                status: 409,
                code: "credits_spend_not_enough",
              }),
            );
          hold = { status: "held", providerJobId: null, leaseUntil: 0 };
          state.holds.set(request.jobId, hold);
        }
        if (hold.status !== "held" || hold.providerJobId || hold.leaseUntil > state.now) return job(request.jobId);
        hold.leaseUntil = state.now + LEASE_MS;
        state.processorSubmits += 1;
        if (state.failSaves > 0) {
          state.failSaves -= 1;
          return Effect.fail(internal());
        }
        hold.providerJobId = `processor-${state.processorSubmits}`;
        return Effect.succeed(view(request.jobId, hold, "processing"));
      }),
    job,
    output: () => Effect.succeed(MP4),
  };
}

function drive<A, E>(state: Account, effect: Effect.Effect<A, E>, onTick: () => void = () => undefined) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.exit(effect));
      for (let tick = 0; tick < 60 * 60 && fiber.pollUnsafe() === undefined; tick += 1) {
        for (let turn = 0; turn < 5; turn += 1) yield* Effect.promise(() => new Promise((done) => setImmediate(done)));
        if (fiber.pollUnsafe() !== undefined) break;
        state.now += 1_000;
        onTick();
        yield* TestClock.adjust("1 second");
      }
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

function workflowsOf(state: Account) {
  return new CreditMediaWorkflows({ gateway: gateway(state), warn: () => undefined, now: () => state.now });
}

function makeVideo(workflows: CreditMediaWorkflows) {
  return workflows.make(() => Effect.succeed(null), {
    jobId: "agent-job",
    model: MODEL,
    job: {
      model: MODEL.id,
      prompt: "A cat on a boat",
      aspect: "9:16",
      resolution: "1080p",
      duration: 10,
      count: 1,
      audio: false,
    },
    images: [],
  });
}

const holdStates = (state: Account) => [...state.holds.values()].map((hold) => hold.status);

async function clientChecks() {
  const polled = account(155);
  polled.doneAt = polled.now + 2 * MINUTE;
  let pollFailed = false;
  const pollExit = await drive(polled, makeVideo(workflowsOf(polled)), () => {
    if (!pollFailed && polled.holds.get("agent-job")?.providerJobId) {
      pollFailed = true;
      polled.failPolls = 1;
    }
  });
  check(
    "an agent video keeps waiting after one failed status check, and the user gets the video with one charge",
    Exit.isSuccess(pollExit) &&
      pollExit.value.bytes.byteLength === MP4.byteLength &&
      pollFailed &&
      polled.failPolls === 0 &&
      holdStates(polled).join() === "charged" &&
      available(polled) === 155 - PRICE,
    { exit: Exit.isSuccess(pollExit) ? "success" : String(pollExit.cause), holds: holdStates(polled) },
  );

  const saved = account(155);
  saved.failSaves = 1;
  saved.doneAt = saved.now + 6 * MINUTE;
  const savedExit = await drive(saved, makeVideo(workflowsOf(saved)));
  check(
    "when the processor job could not be saved, the agent video sends the same job again after its lease and gets the video with one charge",
    Exit.isSuccess(savedExit) &&
      holdStates(saved).join() === "charged" &&
      available(saved) === 155 - PRICE &&
      saved.processorSubmits === 2,
    {
      exit: Exit.isSuccess(savedExit) ? "success" : String(savedExit.cause),
      holds: holdStates(saved),
      submits: saved.processorSubmits,
    },
  );

  const down = account(155);
  down.pollsDown = true;
  const downExit = await drive(down, makeVideo(workflowsOf(down)));
  check(
    "when the account service stays down, the agent video stops after its time limit",
    Exit.isFailure(downExit) && down.now - 1_000_000_000_000 <= 12 * MINUTE,
    { minutes: (down.now - 1_000_000_000_000) / MINUTE },
  );
}

async function toolChecks() {
  const state = account(30);
  const workflows = workflowsOf(state);
  const scope = Scope.makeUnsafe();
  const tools = new CreditMediaTools({
    media: () => workflows,
    approvalCredits: () => 1_000,
    agentsAllowed: () => true,
    enableAgents: () => Effect.void,
    askWhenBlocked: () => false,
    asksMuted: () => false,
    muteAsks: () => Effect.void,
    defaultModels: () => [MODEL.id],
    fitImage: null,
    scope: () => scope,
  });
  const shown: string[] = [];
  const callTool = (args: unknown, onTick?: () => void) =>
    drive(
      state,
      tools.handle({
        agentId: "agent-1",
        turnId: "turn-1",
        tool: "generate_video",
        arguments: args,
        readInputs: (paths) => Effect.succeed(paths.map(() => PNG)),
        approve: () => Effect.succeed({ accepted: true, choice: null, via: "local" as const }),
        hold: () => Effect.succeed({ action: "skip" as const }),
        requesters: [],
        show: (media) =>
          Effect.sync(() => {
            shown.push(media.name);
            return `/saved/${media.name}`;
          }),
      }),
      onTick,
    );
  const failing = (result: Exit.Exit<DynamicToolResult, unknown>) => Exit.isSuccess(result) && !result.value.success;
  const succeeded = (result: Exit.Exit<DynamicToolResult, unknown>) => Exit.isSuccess(result) && result.value.success;
  try {
    const first = await callTool(VIDEO_ARGS, () => {
      if ([...state.holds.values()].some((hold) => hold.providerJobId)) state.pollsDown = true;
    });
    state.pollsDown = false;
    const afterFailure = available(state);
    state.doneAt = state.now;
    const retried = await callTool(Object.fromEntries(Object.entries(VIDEO_ARGS).reverse()));
    const afterRetry = { holds: holdStates(state), shown: [...shown], available: available(state) };
    check(
      "when the account service stays down, the agent call fails, and the same call again (in any key order) gets the first video with one charge, also when the hold leaves too few credits for a new job",
      failing(first) &&
        afterFailure < PRICE &&
        succeeded(retried) &&
        afterRetry.shown.length === 1 &&
        afterRetry.holds.join() === "charged" &&
        afterRetry.available === afterFailure,
      { ...afterRetry, afterFailure },
    );

    state.credits += 30;
    const again = await callTool(VIDEO_ARGS);
    check(
      "the same call after a delivered video makes a new video",
      succeeded(again) && shown.length === 2 && state.holds.size === 2,
      { holds: holdStates(state), shown: [...shown] },
    );

    state.credits += 60;
    state.doneAt = Number.POSITIVE_INFINITY;
    const failedOther = await callTool({ ...VIDEO_ARGS, prompt: "A dog on a boat" }, () => {
      if ([...state.holds.values()].some((hold) => hold.status === "held" && hold.providerJobId))
        state.pollsDown = true;
    });
    state.pollsDown = false;
    state.doneAt = state.now;
    const other = await callTool({ ...VIDEO_ARGS, prompt: "A bird on a boat" });
    check(
      "a different request after a failed call makes its own job",
      failing(failedOther) && succeeded(other) && state.holds.size === 4 && shown.length === 3,
      { holds: holdStates(state), shown: [...shown], available: available(state) },
    );
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
}

let passed = false;
try {
  await clientChecks();
  await toolChecks();
  passed = checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} ${item.name}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
if (!passed) process.exit(1);
