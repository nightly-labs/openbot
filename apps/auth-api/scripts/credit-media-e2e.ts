import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CREDIT_MEDIA_REQUEST_PART } from "@openbot/contracts/credit-media";
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
import { HttpMediaGateway, mediaGatewayFromBinding } from "../src/server/media-gateway";
import { sqliteD1 } from "./sqlite-d1";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, ".openbot-build", "credit-media-e2e");
const MIGRATIONS = join(ROOT, "apps", "auth-api", "migrations");
const GATEWAY = "https://openbot-media-gateway.internal";
const ACCOUNT = "https://account.test";
const OWNER = "owner";
const OUTSIDER = "outsider";
const SERVER_ID = "host-studio";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const logs: string[] = [];
const consoleError = console.error;
console.error = (...values: unknown[]) => {
  logs.push(values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
};

type WelcomeStart = "used" | "unissued";

function migratedDatabase(welcome: WelcomeStart = "used"): DatabaseSync {
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
  if (welcome === "used") {
    for (const user of [OWNER, OUTSIDER]) {
      database
        .prepare(
          "INSERT INTO credit_grants(grant_id, user_id, credits_tenths, remaining_tenths, source, scope, starts_at, expires_at, created_at) VALUES (?, ?, 100, 0, 'welcome', 'welcome', 0, ?, 0)",
        )
        .run(`welcome:${user}`, user, Date.UTC(9999, 11, 31));
    }
  }
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

interface FakeRoute {
  specs: DynamicRecord;
  welcome: string | null;
}

interface FakeJob {
  upstream: string;
  status: string;
  outputs: number;
}

interface FakeSubmit {
  request: DynamicRecord;
  files: { role: string; type: string; size: number }[];
}

function partTypes(raw: string, role: string): string[] {
  return [...raw.matchAll(new RegExp(`name="${role}"[^\\r\\n]*\\r\\nContent-Type: ([^\\r\\n]+)`, "g"))].map(
    (match) => match[1] ?? "",
  );
}

function fakeGateway() {
  const routes = new Map<string, Map<string, FakeRoute>>();
  const jobs = new Map<string, FakeJob>();
  const submits: FakeSubmit[] = [];
  const polls: string[] = [];
  const outputs: string[] = [];
  let active = "router";
  let submitStatus = 200;
  let modelsStatus = 200;
  let sequence = 0;
  let gate: { arrived: () => void; released: Promise<void> } | null = null;
  const routesOf = (upstream: string) => {
    const existing = routes.get(upstream);
    if (existing) return existing;
    const created = new Map<string, FakeRoute>();
    routes.set(upstream, created);
    return created;
  };
  const listed = (upstream: string) =>
    [...routes.entries()].flatMap(([name, models]) =>
      [...models.entries()].flatMap(([id, route]) => {
        if (name === upstream)
          return [
            {
              id,
              upstream: name,
              specs: route.specs,
              ...(route.welcome ? { welcome: { upstream: route.welcome } } : {}),
            },
          ];
        return [];
      }),
    );
  const routedFor = (upstream: string, model: string, funding: unknown) => {
    if (funding === "welcome") return [...routes.values()].some((models) => models.get(model)?.welcome === upstream);
    return routes.get(upstream)?.has(model) === true;
  };
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.origin !== GATEWAY) return Response.json({ error: { code: "wrong_origin" } }, { status: 421 });
    if (url.pathname === "/v1/models") {
      if (modelsStatus !== 200) return Response.json({ error: { code: "down" } }, { status: modelsStatus });
      return Response.json({ models: listed(url.searchParams.get("upstream") ?? active) });
    }
    if (url.pathname === "/v1/jobs" && init?.method === "POST") {
      const body = init.body ?? null;
      const form = await new Request(input, { method: "POST", body }).formData();
      const raw = await new Request(input, { method: "POST", body }).text();
      const head = form.get("request");
      const request = typeof head === "string" ? JSON.parse(head) : null;
      const files = ["first", "last", "reference"].flatMap((role) => {
        const types = partTypes(raw, role);
        return form
          .getAll(role)
          .flatMap((entry, index) =>
            typeof entry === "string" ? [] : [{ role, type: types[index] ?? "", size: entry.size }],
          );
      });
      submits.push({ request: isDynamicRecord(request) ? request : {}, files });
      if (gate) {
        const waiting = gate;
        gate = null;
        waiting.arrived();
        await waiting.released;
      }
      if (submitStatus !== 200) return Response.json({ error: { code: "upstream_said_no" } }, { status: submitStatus });
      const upstream = isDynamicRecord(request) && typeof request.upstream === "string" ? request.upstream : "";
      const model = isDynamicRecord(request) ? request.model : null;
      if (typeof model !== "string" || !routedFor(upstream, model, request.funding))
        return Response.json({ error: { code: "unrouted" } }, { status: 403 });
      sequence += 1;
      const id = `${upstream}-job-${sequence}`;
      jobs.set(`${upstream}/${id}`, { upstream, status: "queued", outputs: 0 });
      return Response.json({ upstream, id, status: "queued", pollAfterSeconds: 3 });
    }
    const job = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/([^/]+)(?:\/(result|outputs)(?:\/(\d+))?)?$/);
    const key = job ? `${decodeURIComponent(job[1] ?? "")}/${decodeURIComponent(job[2] ?? "")}` : "";
    const stored = jobs.get(key);
    if (!job || !stored) return Response.json({ error: { code: "not_found" } }, { status: 404 });
    const id = decodeURIComponent(job[2] ?? "");
    if (!job[3]) {
      polls.push(key);
      return Response.json({ upstream: stored.upstream, id, status: stored.status, pollAfterSeconds: 4 });
    }
    if (job[3] === "result")
      return Response.json({
        artifacts: Array.from({ length: stored.outputs }, () => ({
          mimeType: "image/png",
          width: 64,
          height: 64,
          durationMs: null,
        })),
      });
    const index = Number(job[4]);
    if (!(index < stored.outputs)) return Response.json({ error: { code: "not_found" } }, { status: 404 });
    outputs.push(`${key}/${index}`);
    return new Response(PNG, { headers: { "Content-Type": "image/png", "Content-Length": String(PNG.length) } });
  };
  const find = (providerJobId: string) => {
    const job = [...jobs.entries()].find(([key]) => key.endsWith(`/${providerJobId}`));
    if (!job) throw new Error(`No fake job ${providerJobId}`);
    return job;
  };
  return {
    submits,
    polls,
    outputs,
    fetch,
    route: (upstream: string, model: string, route: Partial<FakeRoute> = {}) =>
      routesOf(upstream).set(model, { specs: route.specs ?? {}, welcome: route.welcome ?? null }),
    unroute: (upstream: string, model: string) => routesOf(upstream).delete(model),
    activate: (upstream: string) => {
      active = upstream;
    },
    setStatus: (providerJobId: string, status: string) => {
      find(providerJobId)[1].status = status;
    },
    complete: (providerJobId: string, count: number) => {
      const [, job] = find(providerJobId);
      job.status = "completed";
      job.outputs = count;
    },
    forget: (providerJobId: string) => {
      jobs.delete(find(providerJobId)[0]);
    },
    setSubmitStatus: (status: number) => {
      submitStatus = status;
    },
    setModelsStatus: (status: number) => {
      modelsStatus = status;
    },
    holdSubmits: () => {
      let arrived = () => {};
      let release = () => {};
      const arrival = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { arrived, released };
      return { arrived: arrival, release };
    },
    lastJobId: () => {
      const last = [...jobs.keys()].at(-1);
      return last?.split("/")[1] ?? "";
    },
  };
}

function routedGateway() {
  const gateway = fakeGateway();
  for (const model of ["image-one", "video-one", "video-off", "video-frames"]) gateway.route("router", model);
  return gateway;
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
  return new Request(`${ACCOUNT}/v1/media/jobs`, { method: "POST", body: form });
}

async function gatewayFlow() {
  const database = migratedDatabase();
  addModels(database);
  let clock = 1_000_000;
  const upstream = routedGateway();
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
    gateway: new HttpMediaGateway(upstream.fetch),
    now: () => clock,
    analytics,
  });
  const offline = new CreditMediaService({ database: sqliteD1(database), gateway: null, now: () => clock });
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

  check("a Worker without the gateway binding has no media gateway", mediaGatewayFromBinding(undefined) === null);
  const empty = await run(offline.catalog());
  check("the catalog is empty while no gateway is bound", empty.models.length === 0, empty);
  const offlineSubmit = await failure(offline.submit(owner, OWNER, submission("image-one")));
  check("a job without a gateway fails as unavailable", offlineSubmit.code === "media_unavailable", offlineSubmit);

  const catalog = await run(service.catalog());
  check(
    "the catalog lists only enabled models, images first, with their D1 prices and no upstream names",
    catalog.models.map((model) => model.id).join(",") === "image-one,video-one,video-frames" &&
      catalog.models[1]?.prices.length === 2 &&
      catalog.models[1]?.prices.every((price) => price.silentCredits !== null) === true &&
      catalog.models[0]?.prices[0]?.silentCredits === null &&
      catalog.unavailable?.length === 0 &&
      !JSON.stringify(catalog).includes("router"),
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
    "an image job holds its price, and the gateway gets the public model, the upstream, the paid funding, the options and the job id",
    image.status === "queued" &&
      image.credits === 3 &&
      (await balance(owner)) === 297 &&
      imageSubmit?.request.kind === "image" &&
      imageSubmit.request.jobId === imageRequest.request.jobId &&
      imageSubmit.request.model === "image-one" &&
      imageSubmit.request.upstream === "router" &&
      imageSubmit.request.funding === "paid" &&
      imageSubmit.request.count === 2 &&
      imageSubmit.request.aspect === "16:9" &&
      imageSubmit.request.inputs === undefined &&
      JSON.stringify(imageSubmit.files) ===
        JSON.stringify([{ role: "reference", type: "image/png", size: PNG.length }]),
    { image, submit: imageSubmit },
  );
  const submitsBefore = upstream.submits.length;
  const again = await run(service.submit(owner, OWNER, imageRequest));
  check(
    "the same job sent again does not start a second generation",
    upstream.submits.length === submitsBefore && again.jobId === image.jobId && (await balance(owner)) === 297,
    again,
  );
  const imageProvider = upstream.lastJobId();
  upstream.setStatus(imageProvider, "processing");
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
  check(
    "an output streams the gateway file as a private attachment",
    output.status === 200 &&
      output.headers.get("Content-Type") === "image/png" &&
      output.headers.get("Cache-Control") === "private, no-store" &&
      output.headers.get("Content-Disposition") === "attachment" &&
      output.headers.get("X-Content-Type-Options") === "nosniff" &&
      bytes.length === PNG.length &&
      upstream.outputs.at(-1) === `router/${imageProvider}/1`,
    { headers: Object.fromEntries(output.headers), outputs: upstream.outputs },
  );
  const missingOutput = await failure(service.output(owner, image.jobId, 5));
  check("an output index past the list is not found", missingOutput.code === "media_job_not_found", missingOutput);

  const videoRequest = submission("video-one", { resolution: "1080p", duration: 10, audio: true }, [
    { role: "first", bytes: PNG, mimeType: "image/png" },
    { role: "last", bytes: WEBP, mimeType: "image/webp" },
  ]);
  const video = await run(service.submit(owner, OWNER, videoRequest));
  const videoSubmit = upstream.submits.at(-1);
  check(
    "a video job holds price per second times duration, and sends frames, duration and audio",
    video.credits === 155 &&
      (await balance(owner)) === 142 &&
      videoSubmit?.request.kind === "video" &&
      videoSubmit.request.duration === 10 &&
      videoSubmit.request.resolution === "1080p" &&
      videoSubmit.request.aspect === "16:9" &&
      videoSubmit.request.audio === true &&
      videoSubmit.files.map((file) => `${file.role}:${file.type}`).join(",") === "first:image/png,last:image/webp",
    { video, submit: videoSubmit },
  );
  upstream.setStatus(upstream.lastJobId(), "failed");
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
    silent.credits === 80 && (await balance(owner)) === 217 && silentSubmit?.request.audio === false,
    { silent, submit: silentSubmit },
  );
  upstream.setStatus(upstream.lastJobId(), "failed");
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
      `a gateway ${status} at submit frees the hold, and the same job sent again does not reach the gateway`,
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
  const retriedSubmits = upstream.submits.filter((item) => item.request.jobId === retryRequest.request.jobId);
  check(
    "an unknown gateway answer keeps the hold, and a retry sends the same job id once more",
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
    "invalid jobs never reach the gateway or change the balance",
    upstream.submits.length === submitsBeforeInvalid && (await balance(owner)) === balanceBeforeInvalid,
  );
  const tooExpensive = await failure(
    service.submit(outsider, OUTSIDER, submission("video-one", { resolution: "1080p", duration: 10 })),
  );
  check(
    "a job that costs more than the free credits is refused before the gateway",
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
      framesSubmit?.request.duration === 5 &&
      framesSubmit.request.resolution === "720p" &&
      framesSubmit.request.aspect === "16:9" &&
      framesSubmit.request.audio === null &&
      framesSubmit.files.map((file) => file.role).join(",") === "first",
    { framesOnly, submit: framesSubmit },
  );

  const reused = submission("image-one");
  await run(service.submit(owner, OWNER, reused));
  const conflict = await failure(service.submit(owner, OWNER, { ...reused, request: { ...reused.request, count: 2 } }));
  check("a job id sent again with other options is a conflict", conflict.code === "credits_job_conflict", conflict);

  const lost = await run(service.submit(owner, OWNER, submission("image-one")));
  upstream.forget(upstream.lastJobId());
  const lostView = await run(service.job(owner, lost.jobId));
  check(
    "a job that the gateway no longer knows (404) is failed and uses no credits",
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
  check("only completed generations have a charge in the ledger", ledgerSpends().length === 2, ledgerSpends());
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
    "generation analytics never send a prompt, a job, a server, an upstream or the gateway address",
    tracked.length > 0 &&
      [SERVER_ID, "media-gateway", "lighthouse", "router", ...jobIds].every((value) => !sentText.includes(value)),
    tracked.length,
  );
  check(
    "logs never show a prompt or the gateway address",
    logs.length > 0 && logs.every((line) => !line.includes("lighthouse") && !line.includes("media-gateway")),
    { logs: logs.length },
  );

  const trail = database
    .prepare(
      `SELECT event, result, code, user_id, server_id, actor_user_id, credits_tenths / 10.0 AS credits, model_id,
              reference, detail
         FROM credit_audit ORDER BY created_at, rowid`,
    )
    .all();
  const audited = (match: Readonly<Record<string, string | number | null>>) =>
    trail.filter((row) => Object.entries(match).every(([key, value]) => row[key] === value));
  const upstreamDetail = (status: number) =>
    trail.filter((row) => {
      const detail = typeof row.detail === "string" ? JSON.parse(row.detail) : null;
      return isDynamicRecord(detail) && detail.operation === "submit" && detail.upstream_status === status;
    });
  const holds = Number(database.prepare("SELECT COUNT(*) AS count FROM credit_holds").get()?.count);
  check(
    "the credit audit has one row for each hold and start, and a charge or release for each settled generation",
    audited({ event: "hold" }).length === holds &&
      audited({ event: "charged", result: "ok", code: "completed" }).length === ledgerSpends().length &&
      audited({ event: "released", code: "refused" }).length === refusedStatuses.length &&
      audited({ event: "charged", server_id: SERVER_ID, model_id: "video-one", credits: 35 }).length === 1 &&
      audited({ event: "released", result: "failed", code: "failed", model_id: "video-one", credits: 155 }).length ===
        1,
    trail,
  );
  check(
    "the credit audit records each refused gateway submit with the gateway status and the model",
    [422, 401, 402, 429, 500].every(
      (status) =>
        upstreamDetail(status).filter(
          (row) =>
            row.event === "media_submit" &&
            row.result === "failed" &&
            row.model_id === "image-one" &&
            row.user_id === OWNER &&
            row.actor_user_id === OWNER,
        ).length === 1,
    ) &&
      audited({ event: "media_submit", code: "media_request_refused" }).length === 1 &&
      audited({ event: "media_submit", code: "media_busy" }).length === 2,
    trail,
  );
  check(
    "the credit audit records invalid, unaffordable and conflicting jobs, and jobs that a wallet cannot see",
    audited({ event: "media_submit", code: "media_request_invalid" }).length === invalidCases.length &&
      audited({ event: "media_submit", code: "media_model_unavailable", model_id: "no-such-model" }).length === 1 &&
      audited({ event: "media_submit", code: "media_unavailable", user_id: OWNER }).length === 3 &&
      audited({
        event: "media_submit",
        code: "credits_spend_not_enough",
        user_id: OUTSIDER,
        model_id: "video-one",
        credits: 80,
      }).length === 1 &&
      audited({ event: "media_submit", code: "credits_job_conflict", reference: reused.request.jobId }).length === 1 &&
      audited({ event: "media_job", code: "media_job_not_found", reference: image.jobId }).length === 2 &&
      audited({ event: "media_output", code: "media_job_not_found", reference: image.jobId }).length === 3,
    trail,
  );
  const trailText = JSON.stringify(trail);
  check(
    "the credit audit never keeps a prompt or the gateway address",
    trail.length > 0 && ["lighthouse", "media-gateway"].every((value) => !trailText.includes(value)),
    trail.length,
  );
}

async function routingFlow() {
  const database = migratedDatabase();
  addModels(database);
  let clock = 1_000_000;
  const gateway = routedGateway();
  const service = new CreditMediaService({
    database: sqliteD1(database),
    gateway: new HttpMediaGateway(gateway.fetch),
    now: () => clock,
  });
  const owner: CreditMediaPayer = { wallet: "personal", userId: OWNER };
  const studio: CreditMediaPayer = { wallet: "server", serverId: SERVER_ID };
  const holdUpstream = (jobId: string) =>
    database.prepare("SELECT upstream FROM credit_holds WHERE job_id = ?").get(jobId)?.upstream ?? null;
  const holdCount = () => database.prepare("SELECT COUNT(*) AS count FROM credit_holds").get()?.count;
  const submitsFor = (jobId: string) => gateway.submits.filter((entry) => entry.request.jobId === jobId);

  const routerJob = await run(service.submit(owner, OWNER, submission("image-one")));
  const routerProvider = gateway.lastJobId();
  check(
    "a job starts on the upstream that the gateway routes the model to, and its hold names that upstream",
    gateway.submits.at(-1)?.request.upstream === "router" && holdUpstream(routerJob.jobId) === "router",
    { routerJob, upstream: holdUpstream(routerJob.jobId) },
  );

  gateway.route("tasks", "image-one");
  const beforeSwitch = await run(service.catalog());
  check(
    "a route on an upstream that is not active changes nothing",
    beforeSwitch.models.map((model) => model.id).join(",") === "image-one,video-one,video-frames",
    beforeSwitch.models.map((model) => model.id),
  );
  gateway.activate("tasks");
  const switched = await run(service.catalog());
  check(
    "after a gateway switch, the catalog lists only the models routed on the active upstream, with no upstream name",
    switched.models.map((model) => model.id).join(",") === "image-one" &&
      !JSON.stringify(switched).includes("tasks") &&
      !JSON.stringify(switched).includes("router"),
    switched.models.map((model) => model.id),
  );
  check(
    "a model with no route on the active upstream stays in the catalog by name only, as unavailable",
    switched.unavailable?.map((model) => model.id).join(",") === "video-one,video-frames" &&
      switched.unavailable.every(
        (model) => Object.keys(model).sort().join(",") === "id,kind,name,variant" && model.name.length > 0,
      ),
    switched.unavailable,
  );
  const holdsBeforeUnrouted = holdCount();
  const submitsBeforeUnrouted = gateway.submits.length;
  const unrouted = await failure(
    service.submit(
      owner,
      OWNER,
      submission("video-frames", { duration: 5 }, [{ role: "first", bytes: PNG, mimeType: "image/png" }]),
    ),
  );
  check(
    "a model with no route on the active upstream is unavailable, holds nothing and sends no job",
    unrouted.code === "media_model_unavailable" &&
      holdCount() === holdsBeforeUnrouted &&
      gateway.submits.length === submitsBeforeUnrouted,
    unrouted,
  );

  const image = await run(service.submit(owner, OWNER, submission("image-one")));
  check(
    "after the switch, the next job goes to the new upstream and its hold names it",
    gateway.submits.at(-1)?.request.upstream === "tasks" && holdUpstream(image.jobId) === "tasks",
    { image, upstream: holdUpstream(image.jobId) },
  );
  gateway.complete(routerProvider, 1);
  const routerDone = await run(service.job(owner, routerJob.jobId));
  check(
    "a job that started before the switch finishes on its first upstream",
    routerDone.status === "completed" &&
      gateway.polls.includes(`router/${routerProvider}`) &&
      !gateway.polls.includes(`tasks/${routerProvider}`),
    { routerDone, polls: gateway.polls },
  );

  gateway.route("tasks", "video-one", { specs: { resolutions: ["720p"], defaultResolution: "720p" } });
  const narrowed = (await run(service.catalog())).models.find((model) => model.id === "video-one");
  const submitsBeforeNarrowed = gateway.submits.length;
  const holdsBeforeNarrowed = holdCount();
  const notOffered = await failure(
    service.submit(owner, OWNER, submission("video-one", { resolution: "1080p", duration: 5 })),
  );
  check(
    "route specs narrow the options and prices of the catalog, and a job outside them is invalid and holds nothing",
    JSON.stringify(narrowed?.resolutions) === JSON.stringify(["720p"]) &&
      narrowed?.prices.map((price) => price.resolution).join(",") === "720p" &&
      notOffered.code === "media_request_invalid" &&
      gateway.submits.length === submitsBeforeNarrowed &&
      holdCount() === holdsBeforeNarrowed,
    { narrowed, notOffered },
  );

  gateway.activate("router");
  const studioRouter = await run(service.submit(studio, null, submission("image-one")));
  const studioRouterProvider = gateway.lastJobId();
  gateway.activate("tasks");
  const studioTasks = await run(service.submit(studio, null, submission("image-one")));
  const studioTasksProvider = gateway.lastJobId();
  gateway.complete(studioRouterProvider, 1);
  gateway.complete(studioTasksProvider, 1);
  clock += CREDIT_HOLD_FIRST_CHECK_MS;
  const swept = await run(service.sweep());
  const sweptRouter = await run(service.job(studio, studioRouter.jobId));
  const sweptTasks = await run(service.job(studio, studioTasks.jobId));
  check(
    "the sweep checks each hold on its own upstream",
    swept.settled >= 2 &&
      sweptRouter.status === "completed" &&
      sweptTasks.status === "completed" &&
      gateway.polls.includes(`router/${studioRouterProvider}`) &&
      gateway.polls.includes(`tasks/${studioTasksProvider}`),
    { swept, sweptRouter, sweptTasks },
  );

  gateway.activate("router");
  const legacy = await run(service.submit(owner, OWNER, submission("image-one")));
  const legacyProvider = gateway.lastJobId();
  gateway.activate("tasks");
  database.prepare("UPDATE credit_holds SET upstream = NULL WHERE job_id = ?").run(legacy.jobId);
  gateway.complete(legacyProvider, 1);
  const legacyDone = await run(service.job(owner, legacy.jobId));
  check(
    "a hold from before the upstream column is checked on the router upstream",
    legacyDone.status === "completed" && gateway.polls.at(-1) === `router/${legacyProvider}`,
    { legacyDone, polls: gateway.polls.at(-1) },
  );

  const forgotten = await run(service.submit(owner, OWNER, submission("image-one")));
  gateway.forget(gateway.lastJobId());
  const forgottenJob = await run(service.job(owner, forgotten.jobId));
  const sweptForgotten = await run(service.submit(studio, null, submission("image-one")));
  gateway.forget(gateway.lastJobId());
  clock += CREDIT_HOLD_FIRST_CHECK_MS;
  await run(service.sweep());
  const sweptForgottenJob = await run(service.job(studio, sweptForgotten.jobId));
  check(
    "a job that the gateway no longer knows (404) fails and frees its hold, on a poll and in the sweep",
    forgottenJob.status === "failed" &&
      forgottenJob.credits === 0 &&
      sweptForgottenJob.status === "failed" &&
      sweptForgottenJob.credits === 0,
    { forgottenJob, sweptForgottenJob },
  );

  const sameJob = submission("image-one");
  const submitsBefore = gateway.submits.length;
  const gate = gateway.holdSubmits();
  const firstSubmit = run(service.submit(owner, OWNER, sameJob));
  await gate.arrived;
  const secondSubmit = await run(service.submit(owner, OWNER, sameJob));
  gate.release();
  const firstDone = await firstSubmit;
  gateway.complete(gateway.lastJobId(), 1);
  const sameDone = await run(service.job(owner, sameJob.request.jobId));
  check(
    "a second submit of a job whose first submit is still running sends nothing, waits as queued, and then follows the one job",
    secondSubmit.status === "queued" &&
      firstDone.status === "queued" &&
      gateway.submits.length === submitsBefore + 1 &&
      sameDone.status === "completed" &&
      sameDone.credits === firstDone.credits,
    { secondSubmit, firstDone, submits: gateway.submits.length - submitsBefore, sameDone },
  );

  gateway.activate("router");
  const lostReply = submission("image-one");
  const unroutedReply = submission("video-one", { duration: 5 });
  gateway.setSubmitStatus(502);
  const lostFirst = await failure(service.submit(owner, OWNER, lostReply));
  const unroutedFirst = await failure(service.submit(owner, OWNER, unroutedReply));
  gateway.setSubmitStatus(200);
  gateway.activate("tasks");
  gateway.unroute("tasks", "video-one");
  const retried = await run(service.submit(owner, OWNER, lostReply));
  gateway.complete(gateway.lastJobId(), 1);
  const retriedDone = await run(service.job(owner, lostReply.request.jobId));
  check(
    "a retry after a lost submit reply goes to the upstream that got the first request, even after a gateway switch",
    lostFirst.code === "media_busy" &&
      retried.status === "queued" &&
      holdUpstream(lostReply.request.jobId) === "router" &&
      submitsFor(lostReply.request.jobId).every((entry) => entry.request.upstream === "router") &&
      submitsFor(lostReply.request.jobId).length === 2 &&
      retriedDone.status === "completed",
    { lostFirst, retried, retriedDone },
  );
  const unroutedRetry = await run(service.submit(owner, OWNER, unroutedReply));
  const newJob = await failure(service.submit(owner, OWNER, submission("video-one", { duration: 5 })));
  check(
    "a retry of a job pinned before the switch still goes there when the model has no route on the new upstream",
    unroutedFirst.code === "media_busy" &&
      unroutedRetry.status === "queued" &&
      gateway.submits.at(-1)?.request.jobId === unroutedReply.request.jobId &&
      gateway.submits.at(-1)?.request.upstream === "router" &&
      newJob.code === "media_model_unavailable",
    { unroutedFirst, unroutedRetry, newJob },
  );

  gateway.activate("router");
  const narrowedReply = submission("video-one", { resolution: "1080p", duration: 10 });
  gateway.setSubmitStatus(502);
  const narrowedFirst = await failure(service.submit(owner, OWNER, narrowedReply));
  gateway.setSubmitStatus(200);
  gateway.route("tasks", "video-one", {
    specs: { resolutions: ["720p"], defaultResolution: "720p", durations: [5], defaultDuration: 5 },
  });
  gateway.activate("tasks");
  const narrowedRetry = await run(service.submit(owner, OWNER, narrowedReply));
  const narrowedSubmit = gateway.submits.at(-1);
  const narrowedNew = await failure(
    service.submit(owner, OWNER, submission("video-one", { resolution: "1080p", duration: 10 })),
  );
  check(
    "a retry of a job pinned before the switch is checked against the pinned route, not a new route that narrows the options",
    narrowedFirst.code === "media_busy" &&
      narrowedRetry.status === "queued" &&
      narrowedSubmit?.request.jobId === narrowedReply.request.jobId &&
      narrowedSubmit.request.upstream === "router" &&
      narrowedSubmit.request.resolution === "1080p" &&
      narrowedNew.code === "media_request_invalid",
    { narrowedFirst, narrowedRetry, submit: narrowedSubmit, narrowedNew },
  );

  gateway.setModelsStatus(503);
  const down = await run(service.catalog());
  const holdsBeforeDown = holdCount();
  const downSubmit = await failure(service.submit(owner, OWNER, submission("image-one")));
  gateway.setModelsStatus(200);
  check(
    "while the gateway cannot list its routes, the catalog shows every model as unavailable and a job is busy and holds nothing",
    down.models.length === 0 &&
      down.unavailable?.map((model) => model.id).join(",") === "image-one,video-one,video-frames" &&
      downSubmit.code === "media_busy" &&
      holdCount() === holdsBeforeDown,
    { down, downSubmit },
  );
}

async function welcomeRouteFlow() {
  const database = migratedDatabase("unissued");
  addModels(database);
  const gateway = routedGateway();
  gateway.route("router", "image-one", { welcome: "tasks" });
  const service = new CreditMediaService({
    database: sqliteD1(database),
    gateway: new HttpMediaGateway(gateway.fetch),
    now: () => 1_000_000,
  });
  const owner: CreditMediaPayer = { wallet: "personal", userId: OWNER };
  const studio: CreditMediaPayer = { wallet: "server", serverId: SERVER_ID };
  const hold = (jobId: string) =>
    database.prepare("SELECT funding, upstream FROM credit_holds WHERE job_id = ?").get(jobId);

  const catalog = await run(service.catalog());
  const first = await run(service.balance(owner));
  check(
    "the catalog marks a model that the gateway gives a free route, never names that route, and the balance shows the free credits",
    catalog.models.find((model) => model.id === "image-one")?.welcome === true &&
      catalog.models.filter((model) => model.welcome).length === 1 &&
      !JSON.stringify(catalog).includes("tasks") &&
      first.available === 310 &&
      first.welcome === 10,
    { catalog, first },
  );

  const freeJob = submission("image-one", { count: 2 });
  await run(service.submit(owner, OWNER, freeJob));
  const freeSubmit = gateway.submits.at(-1)?.request;
  const afterFree = await run(service.balance(owner));
  const serverJob = submission("image-one");
  await run(service.submit(studio, OWNER, serverJob));
  const serverSubmit = gateway.submits.at(-1)?.request;
  const unboundJob = submission("video-one", { duration: 5 });
  await run(service.submit(owner, OWNER, unboundJob));
  const unboundSubmit = gateway.submits.at(-1)?.request;
  check(
    "free credits send a model with free use to its free route as welcome funding, and a server job or a model with no free route is paid",
    freeSubmit?.funding === "welcome" &&
      freeSubmit.upstream === "tasks" &&
      freeSubmit.model === "image-one" &&
      hold(freeJob.request.jobId)?.funding === "welcome" &&
      hold(freeJob.request.jobId)?.upstream === "tasks" &&
      afterFree.welcome === 7 &&
      serverSubmit?.funding === "paid" &&
      serverSubmit.upstream === "router" &&
      hold(serverJob.request.jobId)?.funding === "paid" &&
      unboundSubmit?.funding === "paid" &&
      unboundSubmit.upstream === "router" &&
      hold(unboundJob.request.jobId)?.funding === "paid",
    { freeSubmit, serverSubmit, unboundSubmit, afterFree },
  );

  database.prepare("UPDATE credit_grants SET remaining_tenths = 10 WHERE grant_id = ?").run(`welcome:${OWNER}`);
  const paidJob = submission("image-one");
  await run(service.submit(owner, OWNER, paidJob));
  const paidSubmit = gateway.submits.at(-1)?.request;
  check(
    "a job that the free credits cannot cover uses paid credits and the paid route",
    paidSubmit?.funding === "paid" &&
      paidSubmit.upstream === "router" &&
      hold(paidJob.request.jobId)?.funding === "paid",
    paidSubmit,
  );

  database.exec(
    "UPDATE credit_holds SET status = 'released', outcome = 'canceled', settled_at = 2 WHERE status = 'held'",
  );
  database.prepare("UPDATE credit_grants SET remaining_tenths = 100 WHERE grant_id = ?").run(`welcome:${OWNER}`);
  const serverLedger = database
    .prepare("SELECT SUM(amount_tenths) AS tenths FROM credit_ledger WHERE server_id = ?")
    .get(SERVER_ID);
  database
    .prepare(
      "INSERT INTO credit_ledger(entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at) VALUES ('move:studio', NULL, ?, ?, 'transfer', ?, 'move', 2)",
    )
    .run(SERVER_ID, 10 - Number(serverLedger?.tenths ?? 0), OWNER);
  const emptyServer = await run(service.balance(studio));
  const ownerBefore = await run(service.balance(owner));
  const viaJob = submission("image-one", { count: 2 });
  const viaFirst = await run(service.submit(studio, null, viaJob));
  const viaSubmit = gateway.submits.at(-1)?.request;
  const viaRetry = await run(service.submit(studio, null, viaJob));
  const viaHold = database
    .prepare("SELECT user_id, server_id, actor_user_id, via_server_id, funding FROM credit_holds WHERE job_id = ?")
    .get(viaJob.request.jobId);
  const viaPoll = await run(service.job(studio, viaJob.request.jobId));
  const viaOwnerPoll = await failure(service.job(owner, viaJob.request.jobId));
  const viaProvider = database
    .prepare("SELECT provider_job_id FROM credit_holds WHERE job_id = ?")
    .get(viaJob.request.jobId);
  gateway.complete(String(viaProvider?.provider_job_id ?? ""), 1);
  const viaDone = await run(service.job(studio, viaJob.request.jobId));
  const ownerAfter = await run(service.balance(owner));
  const serverAfter = await run(service.balance(studio));
  check(
    "a server with too few credits makes a free model job on the free credits of its owner, polls it, and the owner sees the spend",
    emptyServer.available === 11 &&
      emptyServer.welcome === 10 &&
      ownerBefore.welcome === 10 &&
      viaSubmit?.funding === "welcome" &&
      viaSubmit.upstream === "tasks" &&
      viaFirst.jobId === viaRetry.jobId &&
      gateway.submits.filter((entry) => entry.request.jobId === viaJob.request.jobId).length === 1 &&
      JSON.stringify(viaHold) ===
        JSON.stringify({
          user_id: OWNER,
          server_id: null,
          actor_user_id: null,
          via_server_id: SERVER_ID,
          funding: "welcome",
        }) &&
      viaPoll.jobId === viaJob.request.jobId &&
      viaOwnerPoll.code === "media_job_not_found" &&
      viaDone.status === "completed" &&
      ownerAfter.welcome === 7 &&
      serverAfter.available === 8 &&
      serverAfter.welcome === 7,
    { emptyServer, ownerBefore, viaSubmit, viaHold, viaOwnerPoll, viaDone, ownerAfter, serverAfter },
  );

  const paidOnServer = await failure(service.submit(studio, null, submission("video-one", { duration: 5 })));
  database.prepare("UPDATE credit_grants SET remaining_tenths = 30 WHERE grant_id = ?").run(`welcome:${OWNER}`);
  const tooBig = await failure(service.submit(studio, null, submission("image-one", { count: 4 })));
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
    VALUES ('member', 'email:member@example.test', 'member@example.test', 1, 1);
    INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
    VALUES ('m-member', '${SERVER_ID}', 'member', 'member', 'active', 1, 1);
  `);
  const memberJob = await failure(service.submit(studio, "member", submission("image-one")));
  check(
    "the owner's free credits never pay for a model with no free use, a job they cannot cover, or a job of another member",
    paidOnServer.code === "credits_spend_not_enough" &&
      tooBig.code === "credits_spend_not_enough" &&
      memberJob.code === "credits_spend_not_enough" &&
      (await run(service.balance(owner))).welcome === 3,
    { paidOnServer, tooBig, memberJob },
  );
}

let passed = false;
try {
  await mkdir(OUT, { recursive: true });
  await gatewayFlow();
  await routingFlow();
  await welcomeRouteFlow();
  passed = checks.every((item) => item.passed);
} finally {
  console.error = consoleError;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) console.log(`${item.passed ? "ok  " : "FAIL"} ${item.name}`);
console.log(`Report: ${join(OUT, "report.json")}`);
if (!passed) process.exit(1);
