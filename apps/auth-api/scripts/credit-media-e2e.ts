import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CREDIT_MEDIA_REQUEST_PART, type CreditMediaJob } from "@openbot/contracts/credit-media";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { createAccountAnalytics } from "../src/server/account-analytics";
import { BillingError, type BillingOperationError } from "../src/server/billing-errors";
import {
  type CreditMediaPayer,
  CreditMediaService,
  type CreditMediaSubmission,
  readCreditMediaSubmission,
} from "../src/server/credit-media-service";
import { CREDIT_HOLD_FIRST_CHECK_MS } from "../src/server/credit-spending";
import { MediaUpstream, mediaUpstreamFromBindings } from "../src/server/media-upstream";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "credit-media-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const UPSTREAM = "https://media.upstream.test";
const ARTIFACTS = "https://cdn.upstream.test";
const API_KEY = "media-key-e2e-secret";
const OWNER = "owner";
const OUTSIDER = "outsider";
const SERVER_ID = "host-studio";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const LIVE = process.argv.includes("--live");
const LIVE_POLL_LIMIT = 60;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const logs: string[] = [];
const consoleError = console.error;
console.error = (...values: unknown[]) => {
  logs.push(values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
};

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).sort()) database.exec(readFileSync(join(MIGRATIONS, name), "utf8"));
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
    VALUES ('${OWNER}', 'email:owner@example.test', 'owner@example.test', 1, 1),
           ('${OUTSIDER}', 'email:outsider@example.test', 'outsider@example.test', 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
    VALUES ('${SERVER_ID}', '${OWNER}', 'Studio', 1, 1);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
    VALUES ('m-owner', '${SERVER_ID}', '${OWNER}', 'owner', 'active', 1, 1);
    INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at)
    VALUES ('purchase:owner', '${OWNER}', NULL, 3000, 'purchase', '${OWNER}', 'cs_owner', 1),
           ('purchase:outsider', '${OUTSIDER}', NULL, 500, 'purchase', '${OUTSIDER}', 'cs_outsider', 1),
           ('transfer:studio', NULL, '${SERVER_ID}', 2000, 'transfer', '${OWNER}', 'studio', 1);
  `);
  return database;
}

function addModels(database: DatabaseSync) {
  const image = {
    aspects: ["1:1", "16:9"],
    defaultAspect: "1:1",
    resolutions: [],
    defaultResolution: null,
    durations: [],
    defaultDuration: null,
    frames: 0,
    references: 2,
    audio: false,
    maxCount: 4,
    promptRequired: true,
  };
  const video = {
    aspects: ["16:9", "9:16"],
    defaultAspect: "16:9",
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    durations: [5, 10],
    defaultDuration: 5,
    frames: 2,
    references: 0,
    audio: true,
    maxCount: 1,
    promptRequired: true,
  };
  database
    .prepare(
      `INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
       VALUES ('image-one', 'up-image-1', 'image', 'Image One', 'Maker', NULL, 1, 1, ?1, '{"quality":"high"}', 1),
              ('video-one', 'up-video-1', 'video', 'Video One', 'Maker', NULL, 2, 1, ?2, '{}', 1),
              ('video-off', 'up-video-2', 'video', 'Video Off', 'Maker', NULL, 3, 0, ?2, '{}', 1),
              ('video-frames', 'up-video-3', 'video', 'Video Frames', 'Maker', NULL, 4, 1, ?3, '{}', 1)`,
    )
    .run(
      JSON.stringify(image),
      JSON.stringify(video),
      JSON.stringify({ ...video, frames: 1, audio: false, promptRequired: false }),
    );
  database.exec(`
    INSERT INTO credit_media_prices(model_id, resolution, unit, credits, silent_credits, updated_at)
    VALUES ('image-one', '', 'item', 1.5, NULL, 1),
           ('video-one', '720p', 'second', 7, 3.5, 1),
           ('video-one', '1080p', 'second', 15.5, 8, 1),
           ('video-off', '', 'second', 1, NULL, 1),
           ('video-frames', '', 'second', 1, NULL, 1);
  `);
}

interface FakeJob {
  status: string;
  artifacts: { url: string; content_type: string }[];
}

function fakeUpstream() {
  const jobs = new Map<string, FakeJob>();
  const submits: { kind: string; body: DynamicRecord; idempotencyKey: string | null; authorized: boolean }[] = [];
  const downloads: { url: string; authorized: boolean }[] = [];
  let submitStatus = 200;
  let sequence = 0;
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    const authorized = headers.get("Authorization") === `Bearer ${API_KEY}`;
    if (url.origin === ARTIFACTS) {
      downloads.push({ url: input, authorized: headers.has("Authorization") });
      return new Response(PNG, { headers: { "Content-Type": "image/png", "Content-Length": String(PNG.length) } });
    }
    if (!authorized) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
    const moved = url.pathname.match(/^\/files\/(.+)$/);
    if (moved) return new Response(null, { status: 302, headers: { Location: `${ARTIFACTS}/${moved[1]}` } });
    const generate = url.pathname.match(/^\/v1\/(image|video)-router\/generate$/);
    if (generate && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      submits.push({
        kind: generate[1] ?? "",
        body: isDynamicRecord(body) ? body : {},
        idempotencyKey: headers.get("Idempotency-Key"),
        authorized,
      });
      if (submitStatus !== 200) return Response.json({ error: { code: "upstream_said_no" } }, { status: submitStatus });
      sequence += 1;
      const id = `up-job-${sequence}`;
      jobs.set(id, { status: "queued", artifacts: [] });
      return Response.json({ data: { job: { id, status: "queued" }, next_poll_after_seconds: 3 } });
    }
    const job = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/(status|result)$/);
    const stored = job ? jobs.get(decodeURIComponent(job[1] ?? "")) : undefined;
    if (!job || !stored) return Response.json({ error: { code: "not_found" } }, { status: 404 });
    const id = decodeURIComponent(job[1] ?? "");
    if (job[2] === "status") return Response.json({ data: { id, status: stored.status, next_poll_after_seconds: 4 } });
    return Response.json({ data: { id, artifacts: stored.artifacts } });
  };
  const complete = (providerJobId: string, count: number) => {
    const job = jobs.get(providerJobId);
    if (!job) throw new Error(`No fake job ${providerJobId}`);
    job.status = "completed";
    job.artifacts = Array.from({ length: count }, (_, index) => ({
      url: `${ARTIFACTS}/${providerJobId}/${index}.png`,
      content_type: "image/png",
    }));
  };
  const moveArtifacts = (providerJobId: string) => {
    const job = jobs.get(providerJobId);
    if (!job) throw new Error(`No fake job ${providerJobId}`);
    job.artifacts = job.artifacts.map((artifact) => ({
      ...artifact,
      url: artifact.url.replace(ARTIFACTS, `${UPSTREAM}/files`),
    }));
  };
  return {
    jobs,
    submits,
    moveArtifacts,
    downloads,
    fetch,
    complete,
    setSubmitStatus: (status: number) => {
      submitStatus = status;
    },
    lastJobId: () => `up-job-${sequence}`,
  };
}

async function run<T>(effect: Effect.Effect<T, BillingError | BillingOperationError>): Promise<T> {
  return Effect.runPromise(effect);
}

async function failure(effect: Effect.Effect<unknown, BillingError | BillingOperationError>) {
  const error = await Effect.runPromise(Effect.flip(effect));
  if (error instanceof BillingError) return { status: error.status, code: error.code };
  return { status: 500, code: error._tag };
}

function submission(
  model: string,
  fields: Partial<CreditMediaSubmission["request"]> = {},
  inputs: CreditMediaSubmission["inputs"] = [],
): CreditMediaSubmission {
  return {
    request: {
      jobId: crypto.randomUUID(),
      model,
      prompt: "A red lighthouse on a cliff at dawn",
      aspect: null,
      resolution: null,
      duration: null,
      count: 1,
      audio: false,
      ...fields,
    },
    inputs,
  };
}

function multipart(request: DynamicRecord | string, files: { role: string; value: Blob | string }[]): Request {
  const form = new FormData();
  form.set(CREDIT_MEDIA_REQUEST_PART, typeof request === "string" ? request : JSON.stringify(request));
  for (const file of files) form.append(file.role, file.value);
  return new Request(`${UPSTREAM}/v1/media/jobs`, { method: "POST", body: form });
}

async function fakeUpstreamFlow() {
  const database = migratedDatabase();
  addModels(database);
  let clock = 1_000_000;
  const upstream = fakeUpstream();
  const media = new MediaUpstream({ baseUrl: UPSTREAM, apiKey: API_KEY, fetch: upstream.fetch });
  const tracked: DynamicRecord[] = [];
  const sends: Promise<void>[] = [];
  const analytics = createAccountAnalytics({
    clientId: "openpanel-test",
    clientSecret: "openpanel-test-secret",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init.body));
      if (isDynamicRecord(body) && body.type === "track" && isDynamicRecord(body.payload)) tracked.push(body.payload);
      return Response.json({});
    },
    schedule: (effect) => sends.push(Effect.runPromise(effect)),
    database: sqliteD1(database),
  });
  const service = new CreditMediaService({
    database: sqliteD1(database),
    upstream: media,
    now: () => clock,
    analytics,
  });
  const offline = new CreditMediaService({ database: sqliteD1(database), upstream: null, now: () => clock });
  const owner: CreditMediaPayer = { wallet: "personal", userId: OWNER };
  const outsider: CreditMediaPayer = { wallet: "personal", userId: OUTSIDER };
  const studio: CreditMediaPayer = { wallet: "server", serverId: SERVER_ID };
  const balance = async (payer: CreditMediaPayer) => (await run(service.balance(payer))).available;
  const ledgerSpends = () =>
    database
      .prepare(
        "SELECT COALESCE(user_id, server_id) AS wallet, amount_tenths / 10.0 AS amount FROM credit_ledger WHERE kind = 'spend'",
      )
      .all();

  check(
    "the media bindings give no upstream while a secret is missing",
    mediaUpstreamFromBindings({ MEDIA_API_URL: UPSTREAM }) === null &&
      mediaUpstreamFromBindings({ MEDIA_API_KEY: API_KEY }) === null,
  );
  const empty = await run(offline.catalog());
  check("the catalog is empty while no upstream is set", empty.models.length === 0, empty);
  const offlineSubmit = await failure(offline.submit(owner, OWNER, submission("image-one")));
  check("a job without an upstream fails as unavailable", offlineSubmit.code === "media_unavailable", offlineSubmit);

  const catalog = await run(service.catalog());
  check(
    "the catalog lists only enabled models, images first, with their D1 prices and no upstream ids",
    catalog.models.map((model) => model.id).join(",") === "image-one,video-one,video-frames" &&
      catalog.models[1]?.prices.length === 2 &&
      catalog.models[1]?.prices.every((price) => price.silentCredits !== null) === true &&
      catalog.models[0]?.prices[0]?.silentCredits === null &&
      !JSON.stringify(catalog).includes("up-"),
    catalog,
  );

  const parsed = await run(
    readCreditMediaSubmission(
      multipart({ jobId: crypto.randomUUID(), model: "video-one", prompt: "x", duration: 5 }, [
        { role: "first", value: new Blob([PNG], { type: "image/png" }) },
        { role: "last", value: new Blob([PNG], { type: "image/png; charset=binary" }) },
      ]),
    ),
  );
  check(
    "a multipart job reads the request part and the frame files",
    parsed.request.model === "video-one" &&
      parsed.inputs.map((input) => `${input.role}:${input.mimeType}:${input.bytes.length}`).join(",") ===
        `first:image/png:${PNG.length},last:image/png:${PNG.length}`,
    parsed.inputs.map((input) => ({ role: input.role, mimeType: input.mimeType })),
  );
  const badJson = await failure(readCreditMediaSubmission(multipart("{not json", [])));
  const textFile = await failure(
    readCreditMediaSubmission(
      multipart({ jobId: crypto.randomUUID(), model: "image-one", prompt: "x" }, [
        { role: "reference", value: "not a file" },
      ]),
    ),
  );
  check(
    "a multipart job with bad JSON or a text field as a file is invalid",
    badJson.code === "media_request_invalid" && textFile.code === "media_request_invalid",
    { badJson, textFile },
  );

  const imageRequest = submission("image-one", { count: 2, aspect: "16:9" }, [
    { role: "reference", bytes: PNG, mimeType: "image/png" },
  ]);
  const image = await run(service.submit(owner, OWNER, imageRequest));
  const imageSubmit = upstream.submits.at(-1);
  check(
    "an image job holds its price, and the upstream gets its own model id, the options and the job id as idempotency key",
    image.status === "queued" &&
      image.credits === 3 &&
      (await balance(owner)) === 297 &&
      imageSubmit?.kind === "image" &&
      imageSubmit.idempotencyKey === imageRequest.request.jobId &&
      imageSubmit.body.model === "up-image-1" &&
      imageSubmit.body.quality === "high" &&
      imageSubmit.body.num_images === 2 &&
      imageSubmit.body.aspect_ratio === "16:9" &&
      Array.isArray(imageSubmit.body.image_urls) &&
      String(imageSubmit.body.image_urls[0]).startsWith("data:image/png;base64,"),
    { image, body: imageSubmit?.body },
  );
  const submitsBefore = upstream.submits.length;
  const again = await run(service.submit(owner, OWNER, imageRequest));
  check(
    "the same job sent again does not start a second generation",
    upstream.submits.length === submitsBefore && again.jobId === image.jobId && (await balance(owner)) === 297,
    again,
  );
  const imageProvider = upstream.lastJobId();
  const upstreamJob = upstream.jobs.get(imageProvider);
  if (upstreamJob) upstreamJob.status = "processing";
  const running = await run(service.job(owner, image.jobId));
  check(
    "a running job keeps its hold and returns the upstream poll interval",
    running.status === "processing" && running.credits === 3 && running.pollAfterSeconds === 4,
    running,
  );
  const hidden = await failure(service.job(outsider, image.jobId));
  const hiddenFromServer = await failure(service.job(studio, image.jobId));
  const hiddenOutput = await failure(service.output(outsider, image.jobId, 0));
  check(
    "another user or a server wallet cannot see or download a personal job",
    hidden.code === "media_job_not_found" &&
      hiddenFromServer.code === "media_job_not_found" &&
      hiddenOutput.code === "media_job_not_found",
    { hidden, hiddenFromServer, hiddenOutput },
  );
  const early = await failure(service.output(owner, image.jobId, 0));
  check("an output is not available before the job completes", early.code === "media_job_not_found", early);

  upstream.complete(imageProvider, 2);
  const done = await run(service.job(owner, image.jobId));
  check(
    "a completed job charges its hold once and lists its outputs",
    done.status === "completed" &&
      done.credits === 3 &&
      done.outputs.length === 2 &&
      done.failure === null &&
      (await balance(owner)) === 297 &&
      ledgerSpends().length === 1,
    { done, spends: ledgerSpends() },
  );
  await run(service.job(owner, image.jobId));
  check("polling a completed job again does not charge again", ledgerSpends().length === 1, ledgerSpends());

  const output = await run(service.output(owner, image.jobId, 1));
  const bytes = new Uint8Array(await output.arrayBuffer());
  const download = upstream.downloads.at(-1);
  check(
    "an output streams the file as a private attachment, and the artifact host never gets the API key",
    output.status === 200 &&
      output.headers.get("Content-Type") === "image/png" &&
      output.headers.get("Cache-Control") === "private, no-store" &&
      output.headers.get("Content-Disposition") === "attachment" &&
      output.headers.get("X-Content-Type-Options") === "nosniff" &&
      bytes.length === PNG.length &&
      download?.url.endsWith(`/${imageProvider}/1.png`) === true &&
      download.authorized === false,
    { headers: Object.fromEntries(output.headers), download },
  );
  const missingOutput = await failure(service.output(owner, image.jobId, 5));
  check("an output index past the list is not found", missingOutput.code === "media_job_not_found", missingOutput);

  const videoRequest = submission("video-one", { resolution: "1080p", duration: 10, audio: true }, [
    { role: "first", bytes: PNG, mimeType: "image/png" },
    { role: "last", bytes: PNG, mimeType: "image/webp" },
  ]);
  const video = await run(service.submit(owner, OWNER, videoRequest));
  const videoSubmit = upstream.submits.at(-1);
  check(
    "a video job holds price per second times duration, and sends frames, duration and audio",
    video.credits === 155 &&
      (await balance(owner)) === 142 &&
      videoSubmit?.kind === "video" &&
      videoSubmit.body.duration === 10 &&
      videoSubmit.body.resolution === "1080p" &&
      videoSubmit.body.aspect_ratio === "16:9" &&
      videoSubmit.body.generate_audio === true &&
      String(videoSubmit.body.image_url).startsWith("data:image/png;base64,") &&
      String(videoSubmit.body.end_image_url).startsWith("data:image/webp;base64,"),
    { video, body: videoSubmit?.body },
  );
  const videoJob = upstream.jobs.get(upstream.lastJobId());
  if (videoJob) videoJob.status = "failed";
  const failed = await run(service.job(owner, video.jobId));
  check(
    "a failed generation frees its hold and uses no credits",
    failed.status === "failed" && failed.failure === "failed" && failed.credits === 0 && (await balance(owner)) === 297,
    failed,
  );

  const silent = await run(
    service.submit(owner, OWNER, submission("video-one", { resolution: "1080p", duration: 10, audio: false })),
  );
  const silentSubmit = upstream.submits.at(-1);
  check(
    "a video job with audio off holds the lower silent price",
    silent.credits === 80 && (await balance(owner)) === 217 && silentSubmit?.body.generate_audio === false,
    { silent, body: silentSubmit?.body },
  );
  const silentJob = upstream.jobs.get(upstream.lastJobId());
  if (silentJob) silentJob.status = "failed";
  await run(service.job(owner, silent.jobId));

  const refusedStatuses: [number, string, string][] = [
    [422, "media_request_refused", "refused"],
    [401, "media_unavailable", "refused"],
    [402, "media_unavailable", "refused"],
    [429, "media_busy", "refused"],
  ];
  for (const [status, code, outcome] of refusedStatuses) {
    upstream.setSubmitStatus(status);
    const request = submission("image-one");
    const refused = await failure(service.submit(owner, OWNER, request));
    upstream.setSubmitStatus(200);
    const submitsAfter = upstream.submits.length;
    const view = await run(service.submit(owner, OWNER, request));
    check(
      `an upstream ${status} at submit frees the hold, and the same job sent again does not reach the upstream`,
      refused.code === code &&
        view.status === "failed" &&
        view.failure === outcome &&
        view.credits === 0 &&
        upstream.submits.length === submitsAfter &&
        (await balance(owner)) === 297,
      { refused, view },
    );
  }

  upstream.setSubmitStatus(500);
  const retryRequest = submission("image-one");
  const unknown = await failure(service.submit(owner, OWNER, retryRequest));
  upstream.setSubmitStatus(200);
  const heldAfterUnknown = await balance(owner);
  const retried = await run(service.submit(owner, OWNER, retryRequest));
  const retriedSubmits = upstream.submits.filter((item) => item.idempotencyKey === retryRequest.request.jobId);
  check(
    "an unknown upstream answer keeps the hold, and a retry sends the same idempotency key once more",
    unknown.code === "media_busy" &&
      heldAfterUnknown === 295.5 &&
      retried.status === "queued" &&
      retried.credits === 1.5 &&
      retriedSubmits.length === 2,
    { unknown, retried, keys: retriedSubmits.length },
  );

  const invalidCases: [string, CreditMediaSubmission][] = [
    ["an unsupported resolution", submission("video-one", { resolution: "4K" })],
    ["an unsupported duration", submission("video-one", { duration: 7 })],
    ["too many images", submission("image-one", { count: 5 })],
    ["an empty prompt", submission("image-one", { prompt: "  " })],
    ["audio on a model without audio", submission("image-one", { audio: true })],
    [
      "too many reference images",
      submission(
        "image-one",
        {},
        Array.from({ length: 3 }, () => ({ role: "reference" as const, bytes: PNG, mimeType: "image/png" })),
      ),
    ],
    [
      "a last frame without a first frame",
      submission("video-one", {}, [{ role: "last", bytes: PNG, mimeType: "image/png" }]),
    ],
    ["no first frame on a model that needs one", submission("video-frames", { prompt: "", resolution: null })],
    [
      "a last frame on a model with one frame",
      submission("video-frames", { prompt: "", resolution: null }, [
        { role: "first", bytes: PNG, mimeType: "image/png" },
        { role: "last", bytes: PNG, mimeType: "image/png" },
      ]),
    ],
    [
      "a frame of an unsupported type",
      submission("video-one", {}, [{ role: "first", bytes: PNG, mimeType: "image/gif" }]),
    ],
  ];
  const submitsBeforeInvalid = upstream.submits.length;
  const balanceBeforeInvalid = await balance(owner);
  for (const [name, request] of invalidCases) {
    const refused = await failure(service.submit(owner, OWNER, request));
    check(`a job with ${name} is invalid and holds nothing`, refused.code === "media_request_invalid", refused);
  }
  const disabled = await failure(service.submit(owner, OWNER, submission("video-off")));
  const missing = await failure(service.submit(owner, OWNER, submission("no-such-model")));
  check(
    "a disabled or unknown model is unavailable",
    disabled.code === "media_model_unavailable" && missing.code === "media_model_unavailable",
    { disabled, missing },
  );
  check(
    "invalid jobs never reach the upstream or change the balance",
    upstream.submits.length === submitsBeforeInvalid && (await balance(owner)) === balanceBeforeInvalid,
  );
  const tooExpensive = await failure(
    service.submit(outsider, OUTSIDER, submission("video-one", { resolution: "1080p", duration: 10 })),
  );
  check(
    "a job that costs more than the free credits is refused before the upstream",
    tooExpensive.code === "credits_spend_not_enough" && upstream.submits.length === submitsBeforeInvalid,
    tooExpensive,
  );
  const framesOnly = await run(
    service.submit(
      outsider,
      OUTSIDER,
      submission("video-frames", { prompt: "", resolution: null }, [
        { role: "first", bytes: PNG, mimeType: "image/png" },
      ]),
    ),
  );
  const framesSubmit = upstream.submits.at(-1);
  check(
    "a model that needs a first frame takes it with no prompt, uses the model defaults, and sends no audio switch",
    framesOnly.credits === 5 &&
      framesSubmit?.body.duration === 5 &&
      framesSubmit.body.resolution === "720p" &&
      framesSubmit.body.aspect_ratio === "16:9" &&
      framesSubmit.body.generate_audio === undefined &&
      framesSubmit.body.end_image_url === undefined &&
      String(framesSubmit.body.image_url).startsWith("data:image/png;base64,"),
    { framesOnly, body: framesSubmit?.body },
  );

  const reused = submission("image-one");
  await run(service.submit(owner, OWNER, reused));
  const conflict = await failure(service.submit(owner, OWNER, { ...reused, request: { ...reused.request, count: 2 } }));
  check("a job id sent again with other options is a conflict", conflict.code === "credits_job_conflict", conflict);

  const lost = await run(service.submit(owner, OWNER, submission("image-one")));
  upstream.jobs.delete(upstream.lastJobId());
  const lostView = await run(service.job(owner, lost.jobId));
  check(
    "a job that the upstream no longer knows is failed and uses no credits",
    lostView.status === "failed" && lostView.credits === 0,
    lostView,
  );
  const emptyResult = await run(service.submit(owner, OWNER, submission("image-one")));
  upstream.complete(upstream.lastJobId(), 0);
  const emptyView = await run(service.job(owner, emptyResult.jobId));
  check(
    "a completed job with no files is failed and uses no credits",
    emptyView.status === "failed" && emptyView.credits === 0,
    emptyView,
  );

  const studioBefore = await balance(studio);
  const studioJob = await run(service.submit(studio, null, submission("video-one", { audio: true })));
  const studioHold = database
    .prepare(
      "SELECT user_id, server_id, actor_user_id, credits_tenths / 10.0 AS credits FROM credit_holds WHERE job_id = ?",
    )
    .get(studioJob.jobId);
  check(
    "a server job holds credits of the server wallet with no member as actor",
    studioJob.credits === 35 &&
      (await balance(studio)) === studioBefore - 35 &&
      studioHold?.server_id === SERVER_ID &&
      studioHold.user_id === null &&
      studioHold.actor_user_id === null,
    { studioJob, studioHold },
  );
  const studioHidden = await failure(service.job(owner, studioJob.jobId));
  check("a personal wallet cannot see a server job", studioHidden.code === "media_job_not_found", studioHidden);

  upstream.complete(upstream.lastJobId(), 1);
  clock += CREDIT_HOLD_FIRST_CHECK_MS;
  const swept = await run(service.sweep());
  const studioAfterSweep = await run(service.job(studio, studioJob.jobId));
  check(
    "the sweep settles a job that nobody polled from the upstream status",
    swept.settled >= 1 && studioAfterSweep.status === "completed" && (await balance(studio)) === studioBefore - 35,
    { swept, studioAfterSweep },
  );

  const emptyStudioJob = await run(service.submit(studio, null, submission("image-one")));
  const studioBeforeEmpty = await balance(studio);
  upstream.complete(upstream.lastJobId(), 0);
  clock += CREDIT_HOLD_FIRST_CHECK_MS;
  await run(service.sweep());
  const emptyStudioHold = database
    .prepare("SELECT status, outcome FROM credit_holds WHERE job_id = ?")
    .get(emptyStudioJob.jobId);
  check(
    "the sweep does not charge a completed job that has no files",
    emptyStudioHold?.status === "released" &&
      emptyStudioHold.outcome === "failed" &&
      (await balance(studio)) === studioBeforeEmpty + emptyStudioJob.credits,
    { emptyStudioHold, before: studioBeforeEmpty, after: await balance(studio) },
  );

  const movedJob = await run(service.submit(owner, OWNER, submission("image-one")));
  const movedProvider = upstream.lastJobId();
  upstream.complete(movedProvider, 1);
  upstream.moveArtifacts(movedProvider);
  await run(service.job(owner, movedJob.jobId));
  const downloadsBeforeMove = upstream.downloads.length;
  const movedOutput = await run(service.output(owner, movedJob.jobId, 0));
  const movedBytes = new Uint8Array(await movedOutput.arrayBuffer());
  const movedDownload = upstream.downloads.at(-1);
  check(
    "an output that redirects to another host follows the redirect without the API key",
    movedOutput.status === 200 &&
      movedBytes.length === PNG.length &&
      upstream.downloads.length === downloadsBeforeMove + 1 &&
      movedDownload?.url === `${ARTIFACTS}/${movedProvider}/0.png` &&
      movedDownload.authorized === false,
    { movedDownload },
  );

  database.exec("UPDATE credit_media_prices SET credits = 2.5, updated_at = 2 WHERE model_id = 'image-one'");
  const repriced = await run(service.catalog());
  const repricedJob = await run(service.submit(owner, OWNER, submission("image-one", { count: 3 })));
  check(
    "a price change in D1 applies to the catalog and the next job with no deploy",
    repriced.models[0]?.prices[0]?.credits === 2.5 && repricedJob.credits === 7.5,
    { prices: repriced.models[0]?.prices, credits: repricedJob.credits },
  );
  database.exec("UPDATE credit_media_models SET enabled = 0 WHERE model_id = 'image-one'");
  const afterDisable = await run(service.catalog());
  const runningAfterDisable = await run(service.job(owner, repricedJob.jobId));
  check(
    "a disabled model leaves the catalog, and its running jobs still settle",
    !afterDisable.models.some((model) => model.id === "image-one") && runningAfterDisable.status === "queued",
    afterDisable.models.map((model) => model.id),
  );

  const negative = database
    .prepare(
      `SELECT wallet, SUM(amount) AS ledger, (SELECT COALESCE(SUM(credits_tenths), 0) FROM credit_holds h
               WHERE COALESCE(h.user_id, h.server_id) = wallet AND h.status = 'held') AS held
         FROM (SELECT COALESCE(user_id, server_id) AS wallet, amount_tenths AS amount FROM credit_ledger)
        GROUP BY wallet HAVING ledger < 0 OR ledger - held < 0`,
    )
    .all();
  check("no wallet has fewer credits than zero or than its holds", negative.length === 0, negative);
  check("only completed generations have a charge in the ledger", ledgerSpends().length === 3, ledgerSpends());
  await Promise.all(sends.splice(0));
  const sent = (profileId: string, expected: Readonly<Record<string, string | number | boolean>>) =>
    tracked.filter(
      (event) =>
        event.profileId === profileId &&
        isDynamicRecord(event.properties) &&
        Object.entries(expected).every(
          ([key, value]) => isDynamicRecord(event.properties) && event.properties[key] === value,
        ),
    );
  check(
    "a generation sends its model, kind, resolution, duration and audio to analytics, and a server job counts for the server owner",
    sent(OWNER, {
      action: "media_started",
      wallet: "personal",
      model_id: "video-one",
      kind: "video",
      credits: 155,
      resolution: "1080p",
      duration_seconds: 10,
      audio: true,
    }).length === 1 &&
      sent(OWNER, { action: "media_released", model_id: "video-one", credits: 155, outcome: "failed" }).length === 1 &&
      sent(OWNER, { action: "media_charged", wallet: "server", model_id: "video-one", kind: "video", credits: 35 })
        .length === 1 &&
      sent(OWNER, {
        action: "media_released",
        wallet: "server",
        model_id: "image-one",
        kind: "image",
        outcome: "failed",
      }).length === 1 &&
      tracked.every(
        (event) => event.name === "credit_action" && (event.profileId === OWNER || event.profileId === OUTSIDER),
      ),
    tracked,
  );
  const sentText = JSON.stringify(tracked);
  const jobIds = database
    .prepare("SELECT job_id, provider_job_id FROM credit_holds")
    .all()
    .flatMap((row) => [row.job_id, row.provider_job_id].filter((id) => typeof id === "string"));
  check(
    "generation analytics never send a prompt, a job, a server or an upstream address",
    tracked.length > 0 &&
      [SERVER_ID, "upstream.test", "lighthouse", API_KEY, ...jobIds].every((value) => !sentText.includes(value)),
    tracked.length,
  );
  check(
    "every upstream request carries the API key, and logs never show the key, a prompt or an upstream URL",
    upstream.submits.every((item) => item.authorized) &&
      logs.length > 0 &&
      logs.every((line) => !line.includes(API_KEY) && !line.includes("lighthouse") && !line.includes("upstream.test")),
    { logs: logs.length },
  );
}

async function liveFlow() {
  const upstream = mediaUpstreamFromBindings({
    MEDIA_API_URL: process.env.MEDIA_API_URL,
    MEDIA_API_KEY: process.env.MEDIA_API_KEY,
  });
  if (!upstream) {
    check("live: MEDIA_API_URL and MEDIA_API_KEY are set", false);
    return;
  }
  const database = migratedDatabase();
  const specs = {
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
  };
  database
    .prepare(
      `INSERT INTO credit_media_models(model_id, upstream_id, kind, name, maker, variant, position, enabled, specs, upstream_params, updated_at)
       VALUES ('z-image-turbo', 'z-image', 'image', 'Z-Image Turbo', 'Alibaba', NULL, 1, 1, ?1, '{}', 1)`,
    )
    .run(JSON.stringify(specs));
  database.exec(
    "INSERT INTO credit_media_prices(model_id, resolution, unit, credits, updated_at) VALUES ('z-image-turbo', '', 'item', 0.5, 1)",
  );
  const service = new CreditMediaService({ database: sqliteD1(database), upstream, now: () => Date.now() });
  const owner: CreditMediaPayer = { wallet: "personal", userId: OWNER };
  const request = submission("z-image-turbo", { prompt: "A small blue paper boat on calm water, studio light" });
  let job: CreditMediaJob = await run(service.submit(owner, OWNER, request));
  check("live: the upstream accepts one image job", job.status === "queued" || job.status === "processing", job);
  for (let poll = 0; poll < LIVE_POLL_LIMIT && (job.status === "queued" || job.status === "processing"); poll += 1) {
    await new Promise((resolvePoll) => setTimeout(resolvePoll, Math.max(1, job.pollAfterSeconds) * 1_000));
    job = await run(service.job(owner, job.jobId));
  }
  const balance = (await run(service.balance(owner))).available;
  check(
    "live: the job completes, charges half a credit, and lists one image",
    job.status === "completed" && job.credits === 0.5 && balance === 299.5 && job.outputs.length === 1,
    { status: job.status, credits: job.credits, failure: job.failure, outputs: job.outputs, balance },
  );
  if (job.status !== "completed") return;
  const output = await run(service.output(owner, job.jobId, 0));
  const bytes = new Uint8Array(await output.arrayBuffer());
  const type = output.headers.get("Content-Type") ?? "";
  check("live: the image streams through the Worker", type.startsWith("image/") && bytes.length > 1_000, {
    type,
    bytes: bytes.length,
  });
  await writeFile(join(OUT, `live-output.${type.split("/")[1] ?? "bin"}`), bytes);
}

let passed = false;
try {
  await mkdir(OUT, { recursive: true });
  await fakeUpstreamFlow();
  if (LIVE) await liveFlow();
  passed = checks.every((item) => item.passed);
} finally {
  console.error = consoleError;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, live: LIVE, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
