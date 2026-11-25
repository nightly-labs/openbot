import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CreditMediaJobRequest, CreditMediaModel } from "@openbot/contracts/credit-media";
import {
  isWorkflowMediaCatalogModel,
  type WorkflowMediaKind,
  type WorkflowMediaSpecs,
  workflowCatalogMediaModel,
  workflowMediaSpecs,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import {
  type CreditMediaGateway,
  CreditMediaGatewayFailed,
  type CreditMediaRequest,
  type CreditMediaUpload,
  CreditMediaWorkflows,
} from "../src/backend/workflows/credit-media";

const OUT = resolve(import.meta.dirname, "../.openbot-build/credit-media-workflow-e2e");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

function model(fields: Partial<CreditMediaModel> & Pick<CreditMediaModel, "id" | "kind">): CreditMediaModel {
  return {
    name: fields.id,
    maker: "Maker",
    variant: null,
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
    prices: [{ resolution: null, unit: fields.kind === "video" ? "second" : "item", credits: 1, silentCredits: null }],
    ...fields,
  };
}

const MODELS: CreditMediaModel[] = [
  model({
    id: "image-text",
    kind: "image",
    aspects: ["16:9", "auto", "1:1", "3:4"],
    defaultAspect: "1:1",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "2K",
    prices: [
      { resolution: "1K", unit: "item", credits: 2, silentCredits: null },
      { resolution: "2K", unit: "item", credits: 3, silentCredits: null },
      { resolution: "4K", unit: "item", credits: 6, silentCredits: null },
    ],
  }),
  model({ id: "image-edit", kind: "image", references: 8, promptRequired: false }),
  model({
    id: "video-both",
    kind: "video",
    aspects: ["9:16", "16:9"],
    defaultAspect: "16:9",
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    durations: [4, 5, 6, 7, 8],
    defaultDuration: 5,
    frames: 2,
    audio: true,
    prices: [
      { resolution: "480p", unit: "second", credits: 4, silentCredits: 2 },
      { resolution: "720p", unit: "second", credits: 7, silentCredits: 3.5 },
      { resolution: "1080p", unit: "second", credits: 15.5, silentCredits: 8 },
    ],
  }),
  model({ id: "video-refs", kind: "video", durations: [5, 10], defaultDuration: 5, references: 3 }),
  model({
    id: "video-frames",
    kind: "video",
    durations: [5, 10],
    defaultDuration: 5,
    frames: 1,
    promptRequired: false,
  }),
];

const submits: { request: CreditMediaJobRequest; inputs: readonly CreditMediaUpload[] }[] = [];
const stored: { name: string; mimeType: string; bytes: number }[] = [];
let submitFailure: CreditMediaGatewayFailed | null = null;
let jobLookups = 0;

const gateway: CreditMediaGateway = {
  available: () => true,
  catalog: () =>
    Effect.succeed({
      models: MODELS,
      unavailable: [{ id: "kling-omni", kind: "video" as const, name: "Kling 4.0", variant: "Omni" }],
    }),
  balance: () => Effect.succeed({ wallet: "personal", available: 100 }),
  submit: (request, inputs) =>
    Effect.suspend(() => (submitFailure ? Effect.fail(submitFailure) : Effect.void)).pipe(
      Effect.map(() => {
        submits.push({ request, inputs });
        const kind = MODELS.find((entry) => entry.id === request.model)?.kind;
        return {
          jobId: request.jobId,
          model: request.model,
          status: "completed" as const,
          credits: 1,
          pollAfterSeconds: 0,
          outputs: [
            {
              index: 0,
              mimeType: kind === "video" ? "video/mp4" : "image/png",
              width: null,
              height: null,
              durationMs: null,
            },
          ],
          failure: null,
        };
      }),
    ),
  job: () =>
    Effect.suspend(() => {
      jobLookups += 1;
      return Effect.fail(new CreditMediaGatewayFailed({ message: "Not found.", status: 404, code: "not_found" }));
    }),
  output: () => Effect.succeed(PNG),
};

const workflows = new CreditMediaWorkflows({ gateway, warn: () => undefined });

function specs(fields: Partial<WorkflowMediaSpecs> = {}): WorkflowMediaSpecs {
  return { aspect: "1:1", duration: 6, resolution: null, transparent: false, size: null, options: [], ...fields };
}

const root = await mkdtemp(join(tmpdir(), "openbot-credit-media-workflow-e2e-"));
const attachments = new Map<string, { path: string; mimeType: string }>();
for (const [id, mimeType] of [
  ["a", "image/png"],
  ["b", "image/png"],
  ["c", "image/jpeg"],
  ["gif", "image/gif"],
] as const) {
  const path = join(root, `${id}.bin`);
  await writeFile(path, PNG);
  attachments.set(id, { path, mimeType });
}

const dependencies = {
  resolveAttachment: (id: string) => Effect.succeed(attachments.get(id) ?? null),
  store: (input: { bytes: Uint8Array; kind: WorkflowMediaKind; name: string; mimeType: string }) =>
    Effect.sync(() => {
      stored.push({ name: input.name, mimeType: input.mimeType, bytes: input.bytes.byteLength });
      return { id: `stored-${stored.length}` };
    }),
};

async function generate(request: Omit<CreditMediaRequest, "model" | "jobId" | "earlierJobIds"> & { model: string }) {
  const before = submits.length;
  const result = await Effect.runPromise(
    Effect.result(
      workflows.generate(dependencies, {
        ...request,
        jobId: randomUUID(),
        earlierJobIds: [],
        model: `openbot-${request.model}`,
      }),
    ),
  );
  const submitted = submits.length > before ? submits.at(-1) : undefined;
  return {
    failure: Result.isFailure(result) ? result.failure.message : null,
    request: submitted?.request,
    roles: submitted?.inputs.map((input) => input.role) ?? [],
  };
}

async function flow() {
  const listed = await Effect.runPromise(workflows.catalog());
  const catalog = listed.models;
  const entry = (id: string) => catalog.find((item) => item.id === `openbot-${id}`);
  check(
    "a model with no route stays by workflow id and full name, apart from the models that can run",
    JSON.stringify(listed.unavailable) ===
      JSON.stringify([{ id: "openbot-kling-omni", name: "Kling 4.0 · Omni", kinds: ["video"] }]) &&
      entry("kling-omni") === undefined,
    { unavailable: listed.unavailable },
  );
  const imageText = entry("image-text");
  const videoBoth = entry("video-both");
  check(
    "the catalog puts the model default aspect and resolution first and keeps only known aspects",
    imageText?.aspects.join(",") === "1:1,16:9,3:4" &&
      imageText.resolutions.join(",") === "2K,1K,4K" &&
      videoBoth?.aspects[0] === "16:9" &&
      videoBoth.resolutions[0] === "720p",
    { imageText, videoBoth },
  );
  check(
    "the catalog gives each model its inputs, an empty list for a model with none, and an audio switch only where the model has audio",
    imageText !== undefined &&
      imageText.inputs?.length === 0 &&
      imageText.options === undefined &&
      entry("image-edit")?.inputs?.join(",") === "references" &&
      videoBoth?.inputs?.join(",") === "frames" &&
      videoBoth.options?.[0]?.name === "audio" &&
      videoBoth.options[0].default === "on" &&
      entry("video-refs")?.inputs?.join(",") === "references" &&
      entry("video-frames")?.inputs?.join(",") === "frames",
    catalog,
  );

  const videoFrames = entry("video-frames");
  const videoModel = videoBoth ? workflowCatalogMediaModel(videoBoth) : null;
  const unsetLength = workflowMediaSpecs({ media: "video" }, "video", videoModel).duration;
  const chosenLength = workflowMediaSpecs({ media: "video", duration: 8 }, "video", videoModel).duration;
  check(
    "the catalog gives the model default length and frame count, and a step with no length uses the model default",
    videoBoth?.defaultDuration === 5 &&
      videoBoth.frameCount === 2 &&
      videoFrames?.frameCount === 1 &&
      entry("video-refs")?.frameCount === undefined &&
      videoModel?.frameCount === 2 &&
      unsetLength === 5 &&
      chosenLength === 8 &&
      isWorkflowMediaCatalogModel(videoBoth) &&
      isWorkflowMediaCatalogModel(videoFrames) &&
      !isWorkflowMediaCatalogModel({ ...videoFrames, frameCount: 3 }),
    { videoBoth, videoFrames, unsetLength, chosenLength },
  );

  const sameImage = await generate({
    kind: "video",
    model: "video-both",
    prompt: "A boat",
    specs: specs({ aspect: "4:5", resolution: "1080p" }),
    images: [
      { role: "first", attachmentId: "a" },
      { role: "last", attachmentId: "a" },
    ],
  });
  check(
    "one picture on both frame ports goes up as the first and the last frame",
    sameImage.failure === null && sameImage.roles.join(",") === "first,last",
    sameImage,
  );
  check(
    "an aspect that the model does not have falls back to the model default, and audio is on by default",
    sameImage.request?.aspect === "16:9" &&
      sameImage.request.resolution === "1080p" &&
      sameImage.request.duration === 6 &&
      sameImage.request.audio === true,
    sameImage.request,
  );

  const audioOff = await generate({
    kind: "video",
    model: "video-both",
    prompt: "A boat",
    specs: specs({ duration: 9, options: [{ name: "audio", value: "off" }] }),
    images: [],
  });
  check(
    "the audio switch turns audio off, and a duration out of range falls back to the model default",
    audioOff.request?.audio === false && audioOff.request.duration === 5 && audioOff.request.resolution === "720p",
    audioOff.request,
  );

  const spareFrames = await generate({
    kind: "video",
    model: "video-both",
    prompt: "A boat",
    specs: specs(),
    images: [
      { role: "reference", attachmentId: "a" },
      { role: "reference", attachmentId: "b" },
    ],
  });
  check(
    "pictures on the reference port become the frames of a model with frames and no references",
    spareFrames.failure === null && spareFrames.roles.join(",") === "first,last",
    spareFrames,
  );

  const framesAsReferences = await generate({
    kind: "video",
    model: "video-refs",
    prompt: "A boat",
    specs: specs(),
    images: [
      { role: "first", attachmentId: "a" },
      { role: "last", attachmentId: "b" },
      { role: "reference", attachmentId: "c" },
    ],
  });
  check(
    "frame pictures become references of a model with references and no frames",
    framesAsReferences.failure === null && framesAsReferences.roles.join(",") === "reference,reference,reference",
    framesAsReferences,
  );

  const textOnly = await generate({
    kind: "image",
    model: "image-text",
    prompt: "A boat",
    specs: specs({ aspect: "3:4", resolution: null }),
    images: [{ role: "reference", attachmentId: "gif" }],
  });
  check(
    "a text-only image model sends no pictures and uses its default resolution",
    textOnly.failure === null &&
      textOnly.roles.length === 0 &&
      textOnly.request?.aspect === "3:4" &&
      textOnly.request.resolution === "2K" &&
      textOnly.request.duration === null,
    textOnly,
  );

  const submitsBefore = submits.length;
  const noPicture = await generate({ kind: "image", model: "image-edit", prompt: "", specs: specs(), images: [] });
  const noFirstFrame = await generate({
    kind: "video",
    model: "video-frames",
    prompt: "A boat",
    specs: specs(),
    images: [{ role: "last", attachmentId: "a" }],
  });
  const noPrompt = await generate({
    kind: "image",
    model: "image-text",
    prompt: "  ",
    specs: specs(),
    images: [],
  });
  const wrongType = await generate({
    kind: "image",
    model: "image-edit",
    prompt: "",
    specs: specs(),
    images: [{ role: "reference", attachmentId: "gif" }],
  });
  check(
    "a model that needs a picture, a first frame or a prompt stops with a clear error before any request",
    noPicture.failure === sourceText("error.workflow.creditMediaPictureRequired") &&
      noFirstFrame.failure === sourceText("error.workflow.creditMediaPictureRequired") &&
      noPrompt.failure === sourceText("error.workflow.creditMediaPromptRequired") &&
      wrongType.failure === sourceText("error.workflow.mediaInputType") &&
      submits.length === submitsBefore,
    { noPicture, noFirstFrame, noPrompt, wrongType },
  );

  const edit = await generate({
    kind: "image",
    model: "image-edit",
    prompt: "",
    specs: specs(),
    images: [
      { role: "reference", attachmentId: "a" },
      { role: "reference", attachmentId: "a" },
      { role: "reference", attachmentId: "c" },
    ],
  });
  check(
    "an edit model takes pictures with no prompt and sends each picture once",
    edit.failure === null && edit.roles.join(",") === "reference,reference",
    edit,
  );

  const framesOnly = await generate({
    kind: "video",
    model: "video-frames",
    prompt: "",
    specs: specs(),
    images: [
      { role: "first", attachmentId: "a" },
      { role: "last", attachmentId: "b" },
    ],
  });
  check(
    "a model with one frame takes the first frame and leaves out the last one",
    framesOnly.failure === null && framesOnly.roles.join(",") === "first",
    framesOnly,
  );

  const price = (fields: Partial<WorkflowMediaSpecs>, id = "video-both") =>
    Effect.runPromise(
      workflows.price({
        model: `openbot-${id}`,
        kind: MODELS.find((entry) => entry.id === id)?.kind ?? "video",
        aspect: "16:9",
        duration: fields.duration ?? 6,
        resolution: fields.resolution ?? null,
        transparent: false,
        options: fields.options ?? [],
      }),
    );
  const prices = {
    video1080: await price({ resolution: "1080p", duration: 6 }),
    videoDefault: await price({ duration: 9 }),
    imageDefault: await price({}, "image-text"),
    image4k: await price({ resolution: "4K" }, "image-text"),
    video1080Silent: await price({ resolution: "1080p", duration: 6, options: [{ name: "audio", value: "off" }] }),
  };
  check(
    "the price uses the same resolution, duration and audio switch as the job",
    prices.video1080 === 93 &&
      prices.videoDefault === 35 &&
      prices.imageDefault === 3 &&
      prices.image4k === 6 &&
      prices.video1080Silent === 48,
    prices,
  );
  const refused = async (code: string) => {
    submitFailure = new CreditMediaGatewayFailed({ message: `Refused: ${code}.`, status: 409, code });
    const lookupsBefore = jobLookups;
    try {
      const result = await generate({
        kind: "image",
        model: "image-text",
        prompt: "A boat",
        specs: specs(),
        images: [],
      });
      return { failure: result.failure, lookups: jobLookups - lookupsBefore };
    } finally {
      submitFailure = null;
    }
  };
  const notEnough = await refused("credits_spend_not_enough");
  const conflict = await refused("credits_job_conflict");
  check(
    "a 409 for too few credits shows that error; only a job conflict looks up the job again",
    notEnough.failure === "Refused: credits_spend_not_enough." &&
      conflict.lookups === notEnough.lookups + 1 &&
      conflict.failure === "Not found.",
    { notEnough, conflict },
  );
  check(
    "each finished job stores its file with the right type",
    stored.length === submits.length &&
      stored.some((file) => file.name === "openbot-video.mp4" && file.mimeType === "video/mp4") &&
      stored.some((file) => file.name === "openbot-image.png" && file.mimeType === "image/png"),
    stored,
  );
}

let passed = false;
try {
  await flow();
  passed = checks.every((item) => item.passed);
} finally {
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} ${item.name}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
if (!passed) process.exit(1);
