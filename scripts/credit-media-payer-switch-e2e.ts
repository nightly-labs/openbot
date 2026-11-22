import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CREDIT_MEDIA_REQUEST_PART,
  type CreditMediaJob,
  type CreditMediaModel,
  parseCreditMediaJobRequest,
} from "@openbot/contracts/credit-media";
import { Effect, Result } from "effect";
import { CreditMediaWorkflows } from "../src/backend/workflows/credit-media";
import { CentralAuthOperationError } from "../src/main/central-auth-effects";
import { createCreditMediaGateway } from "../src/main/credit-media-gateway";

const OUT = resolve(import.meta.dirname, "../.openbot-build/credit-media-payer-switch-e2e");
const HOST_ID = "host-1";
const SERVER = `server:${HOST_ID}`;
const PERSONAL = "personal";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const MODEL: CreditMediaModel = {
  id: "image-one",
  name: "Image One",
  maker: "Maker",
  variant: null,
  kind: "image",
  aspects: ["1:1"],
  defaultAspect: "1:1",
  resolutions: [],
  defaultResolution: null,
  durations: [],
  defaultDuration: null,
  frames: 0,
  references: 0,
  audio: false,
  maxCount: 1,
  promptRequired: true,
  prices: [{ resolution: null, unit: "item", credits: 1.5, silentCredits: null }],
};

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push(detail === undefined ? { name, passed } : { name, passed, detail });
}

interface AccountJob {
  owner: string;
  polls: number;
  completeAfter: number;
}

interface Call {
  payer: string;
  method: string;
  path: string;
  status: number;
}

interface Account {
  session: boolean;
  credential: boolean;
  jobs: Map<string, AccountJob>;
  calls: Call[];
  onSubmit: () => void;
}

const account: Account = {
  session: false,
  credential: true,
  jobs: new Map(),
  calls: [],
  onSubmit: () => {},
};

function reset(session: boolean) {
  account.session = session;
  account.credential = true;
  account.jobs.clear();
  account.calls = [];
  account.onSubmit = () => {};
}

function failure(status: number, code = "") {
  return new CentralAuthOperationError({
    cause: Object.assign(new Error(`Account service ${status}.`), { status, code }),
  });
}

function jobView(jobId: string, job: AccountJob): CreditMediaJob {
  const completed = job.polls >= job.completeAfter;
  return {
    jobId,
    model: MODEL.id,
    status: completed ? "completed" : "processing",
    credits: 1.5,
    pollAfterSeconds: 0,
    outputs: completed ? [{ index: 0, mimeType: "image/png", width: null, height: null, durationMs: null }] : [],
    failure: null,
  };
}

function requestJobId(init: RequestInit): string | null {
  if (!(init.body instanceof FormData)) return null;
  const part = init.body.get(CREDIT_MEDIA_REQUEST_PART);
  return typeof part === "string" ? (parseCreditMediaJobRequest(JSON.parse(part))?.jobId ?? null) : null;
}

function handle(payer: string, path: string, init: RequestInit): { status: number; code?: string; body?: unknown } {
  if (path === "/v1/media/models") return { status: 200, body: { models: [MODEL] } };
  if (path === "/v1/media/balance") return { status: 200, body: { wallet: "personal", available: 100 } };
  if (path === "/v1/media/jobs/" && init.method === "POST") {
    const jobId = requestJobId(init);
    if (!jobId) return { status: 400 };
    const existing = account.jobs.get(jobId);
    if (existing && existing.owner !== payer) return { status: 409, code: "credits_job_conflict" };
    const job = existing ?? { owner: payer, polls: 0, completeAfter: 2 };
    account.jobs.set(jobId, job);
    account.onSubmit();
    return { status: 200, body: jobView(jobId, job) };
  }
  const match = /^\/v1\/media\/jobs\/([^/]+)\/(?:outputs\/0)?$/u.exec(path);
  const job = match?.[1] ? account.jobs.get(decodeURIComponent(match[1])) : undefined;
  if (!match?.[1] || !job || job.owner !== payer) return { status: 404 };
  if (path.endsWith("/outputs/0"))
    return jobView(match[1], job).status === "completed" ? { status: 200 } : { status: 409 };
  job.polls += 1;
  return { status: 200, body: jobView(match[1], job) };
}

function respond<T>(payer: string, path: string, init: RequestInit, read: (body: unknown) => T) {
  return Effect.suspend(() => {
    const result = handle(payer, path, init);
    account.calls.push({ payer, method: init.method ?? "GET", path, status: result.status });
    if (result.status !== 200) return Effect.fail(failure(result.status, result.code));
    return Effect.try({ try: () => read(result.body), catch: (cause) => new CentralAuthOperationError({ cause }) });
  });
}

const auth = {
  hasSession: () => account.session,
  hostSiteCredential: (hostId: string) =>
    account.credential && hostId === HOST_ID ? { hostId, machineToken: "machine" } : null,
  requestAuthorized: <T>(path: string, init: RequestInit, decode: (value: unknown) => T) =>
    account.session ? respond(PERSONAL, path, init, decode) : Effect.fail(failure(401)),
  requestAsHost: <T>(hostId: string, path: string, init: RequestInit, decode: (value: unknown) => T) =>
    respond(`server:${hostId}`, path, init, decode),
  downloadAuthorized: (path: string) =>
    account.session ? respond(PERSONAL, path, { method: "GET" }, () => PNG) : Effect.fail(failure(401)),
  downloadAsHost: (hostId: string, path: string) => respond(`server:${hostId}`, path, { method: "GET" }, () => PNG),
};

const stored: string[] = [];
const dependencies = {
  resolveAttachment: () => Effect.succeed(null),
  store: () =>
    Effect.sync(() => {
      stored.push(`file-${stored.length + 1}`);
      return { id: `file-${stored.length}` };
    }),
};

async function generate(serverWallet: boolean, jobId: string) {
  const gateway = createCreditMediaGateway({
    auth,
    hostId: () => HOST_ID,
    serverWallet,
  });
  const workflows = new CreditMediaWorkflows({ gateway, warn: () => undefined });
  const result = await Effect.runPromise(
    Effect.result(
      workflows.generate(dependencies, {
        jobId,
        earlierJobIds: [],
        kind: "image",
        model: `openbot-${MODEL.id}`,
        prompt: "A red boat",
        specs: { aspect: "1:1", duration: 0, resolution: null, transparent: false, size: null, options: [] },
        images: [],
      }),
    ),
  );
  return Result.isFailure(result) ? { file: null, failure: result.failure.message } : { file: result.success };
}

const submits = () => account.calls.filter((call) => call.method === "POST");
const downloads = () => account.calls.filter((call) => call.path.endsWith("/outputs/0"));

async function signInDuringGeneration() {
  reset(false);
  account.onSubmit = () => {
    account.session = true;
  };
  const jobId = randomUUID();
  const result = await generate(false, jobId);
  const polls = account.calls.filter((call) => call.method === "GET" && call.path.endsWith(`${jobId}/`));
  check(
    "a server that signs in to an account during a generation still gets the file of the server's job",
    result.file !== null &&
      submits().length === 1 &&
      submits()[0]?.payer === SERVER &&
      account.jobs.get(jobId)?.owner === SERVER &&
      polls.every((call) => call.payer === SERVER) &&
      polls.some((call) => call.status === 200) &&
      downloads().at(-1)?.payer === SERVER &&
      downloads().at(-1)?.status === 200,
    { result, calls: account.calls },
  );
}

async function retryAfterSignIn() {
  reset(true);
  const jobId = randomUUID();
  account.jobs.set(jobId, { owner: SERVER, polls: 0, completeAfter: 0 });
  const result = await generate(false, jobId);
  check(
    "a retry after the server signed in finds the server's job and does not start a second paid generation",
    result.file !== null &&
      submits().length === 0 &&
      account.jobs.size === 1 &&
      downloads().at(-1)?.payer === SERVER &&
      downloads().at(-1)?.status === 200,
    { result, calls: account.calls },
  );
}

async function serverWalletStaysOnServer() {
  reset(true);
  const jobId = randomUUID();
  const result = await generate(true, jobId);
  check(
    "when the server's credits pay, the gateway never asks with the personal account",
    result.file !== null &&
      account.calls.every((call) => call.payer === SERVER) &&
      account.jobs.get(jobId)?.owner === SERVER,
    { result, calls: account.calls },
  );
}

async function hostServerPaysFirst() {
  reset(true);
  const jobId = randomUUID();
  const result = await generate(false, jobId);
  check(
    "a signed-in computer that hosts a server pays with the server's credits, not with its own account",
    result.file !== null &&
      submits().length === 1 &&
      submits()[0]?.payer === SERVER &&
      account.calls
        .filter((call) => call.payer === PERSONAL)
        .every((call) => call.method === "GET" && call.status === 404) &&
      downloads().every((call) => call.payer === SERVER),
    { result, calls: account.calls },
  );
}

async function personalJobFoundAfterServer() {
  reset(true);
  const jobId = randomUUID();
  account.jobs.set(jobId, { owner: PERSONAL, polls: 0, completeAfter: 0 });
  const result = await generate(false, jobId);
  check(
    "a job that the personal account owns is found with the personal account after the server lookup finds nothing",
    result.file !== null &&
      submits().length === 0 &&
      account.calls
        .filter((call) => call.payer === SERVER)
        .every((call) => call.method === "GET" && call.status === 404) &&
      downloads().at(-1)?.payer === PERSONAL &&
      downloads().at(-1)?.status === 200,
    { result, calls: account.calls },
  );
}

async function accountPaysWithoutServer() {
  reset(true);
  account.credential = false;
  const jobId = randomUUID();
  const result = await generate(false, jobId);
  check(
    "a signed-in computer that hosts no server pays with its own account",
    result.file !== null &&
      submits().length === 1 &&
      submits()[0]?.payer === PERSONAL &&
      account.calls.every((call) => call.payer === PERSONAL),
    { result, calls: account.calls },
  );
}

let passed = false;
try {
  await signInDuringGeneration();
  await retryAfterSignIn();
  await serverWalletStaysOnServer();
  await hostServerPaysFirst();
  await personalJobFoundAfterServer();
  await accountPaysWithoutServer();
  passed = checks.length === 6 && checks.every((item) => item.passed);
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} ${item.name}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
if (!passed) process.exit(1);
