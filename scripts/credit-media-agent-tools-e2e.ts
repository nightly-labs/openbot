import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  CreditMediaGenerationKind,
  CreditMediaJobRequest,
  CreditMediaModel,
} from "@openbot/contracts/credit-media";
import type { MediaApprovalChoice, MediaApprovalOffer } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { z } from "zod";
import type { CreditsHoldAnswer, CreditsHoldCall, CreditsHoldWallet } from "../src/backend/agent/attention-registry";
import {
  CREDIT_MEDIA_TOOL_DEFINITIONS,
  type CreditAsksPerson,
  type CreditMediaReport,
  type CreditMediaShown,
  CreditMediaToolInputFailed,
  CreditMediaTools,
  DEFAULT_MEDIA_APPROVAL_CREDITS,
} from "../src/backend/agent/credit-media-tools";
import { OPENBOT_TOOL_DEFINITIONS } from "../src/backend/openbot-tools";
import type { DynamicToolResult } from "../src/backend/protocol";
import {
  type CreditMediaGateway,
  CreditMediaGatewayFailed,
  type CreditMediaUpload,
  CreditMediaWorkflows,
} from "../src/backend/workflows/credit-media";

const OUT = resolve(import.meta.dirname, "../.openbot-build/credit-media-agent-tools-e2e");
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x07, 0x80, 0, 0, 0x04,
  0x38, 8, 6, 0, 0, 0,
]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

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
    aspects: ["16:9", "1:1", "3:4"],
    defaultAspect: "1:1",
    resolutions: ["1K", "2K"],
    defaultResolution: "2K",
    prices: [
      { resolution: "1K", unit: "item", credits: 2, silentCredits: null },
      { resolution: "2K", unit: "item", credits: 3, silentCredits: null },
    ],
  }),
  model({ id: "image-edit", kind: "image", variant: "Edit", references: 4 }),
  model({
    id: "video-both",
    kind: "video",
    aspects: ["9:16", "16:9"],
    defaultAspect: "16:9",
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    durations: [4, 8],
    defaultDuration: 4,
    frames: 2,
    audio: true,
    prices: [
      { resolution: "720p", unit: "second", credits: 7, silentCredits: 3 },
      { resolution: "1080p", unit: "second", credits: 15.5, silentCredits: 8 },
    ],
  }),
  model({ id: "video-refs", kind: "video", durations: [5], defaultDuration: 5, references: 3 }),
];

const submits: { request: CreditMediaJobRequest; inputs: readonly CreditMediaUpload[] }[] = [];
const runningJobs = new Map<string, boolean>();
let heldJob: Deferred.Deferred<string> | null = null;
let signedIn = true;
let walletBalance = 100;
const gateway: CreditMediaGateway = {
  available: () => signedIn,
  catalog: () => Effect.succeed({ models: MODELS, unavailable: [] }),
  balance: () => Effect.sync(() => ({ wallet: "personal" as const, available: walletBalance })),
  submit: (request, inputs) =>
    Effect.sync(() => {
      submits.push({ request, inputs });
      const video = MODELS.find((entry) => entry.id === request.model)?.kind === "video";
      const held = heldJob;
      heldJob = null;
      if (held) {
        runningJobs.set(request.jobId, false);
        Deferred.doneUnsafe(held, Effect.succeed(request.jobId));
      }
      return {
        jobId: request.jobId,
        model: request.model,
        status: held ? ("processing" as const) : ("completed" as const),
        credits: 7,
        pollAfterSeconds: 0,
        outputs: [
          { index: 0, mimeType: video ? "video/mp4" : "image/png", width: null, height: null, durationMs: null },
        ],
        failure: null,
      };
    }),
  job: (jobId) => {
    const finished = runningJobs.get(jobId);
    if (finished === undefined)
      return Effect.fail(new CreditMediaGatewayFailed({ message: "Not found.", status: 404, code: "not_found" }));
    return Effect.succeed({
      jobId,
      model: "video-both",
      status: finished ? ("completed" as const) : ("processing" as const),
      credits: 7,
      pollAfterSeconds: 0,
      outputs: finished ? [{ index: 0, mimeType: "video/mp4", width: null, height: null, durationMs: null }] : [],
      failure: null,
    });
  },
  output: (jobId) =>
    Effect.sync(() => {
      const request = submits.find((entry) => entry.request.jobId === jobId)?.request;
      return MODELS.find((entry) => entry.id === request?.model)?.kind === "video" ? MP4 : PNG;
    }),
};

let approvalCredits = DEFAULT_MEDIA_APPROVAL_CREDITS;
let defaultModels: Record<CreditMediaGenerationKind, string | null> = { image: null, video: null };
let agentsAllowed = true;
let askWhenBlocked = true;
const mutedMembers = new Set<string>();
const mutes: (CreditAsksPerson | null)[] = [];
const toolScope = Scope.makeUnsafe();
const reports: CreditMediaReport[] = [];
let nextReport: Deferred.Deferred<CreditMediaReport> | null = null;
const tools = new CreditMediaTools({
  media: () => workflows,
  scope: () => toolScope,
  agentsAllowed: () => agentsAllowed,
  enableAgents: () =>
    Effect.sync(() => {
      agentsAllowed = true;
    }),
  askWhenBlocked: () => askWhenBlocked,
  asksMuted: (personIds) => personIds.length > 0 && personIds.every((id) => mutedMembers.has(id)),
  muteAsks: (person) =>
    Effect.sync(() => {
      mutes.push(person);
      if (!person || person.canAdminister) askWhenBlocked = false;
      else mutedMembers.add(person.id);
    }),
  approvalCredits: () => approvalCredits,
  defaultModel: (kind) => defaultModels[kind],
  fitImage: (bytes) => ({
    dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    width: 1920,
    height: 1080,
    sourceWidth: 1920,
    sourceHeight: 1080,
  }),
  report: (report) => {
    reports.push(report);
    if (nextReport) Deferred.doneUnsafe(nextReport, Effect.succeed(report));
  },
});
let creditsChanges = 0;
const workflows = new CreditMediaWorkflows({
  gateway,
  warn: () => undefined,
  creditsChanged: () => {
    creditsChanges += 1;
  },
});

const ToolData = z.looseObject({
  status: z.string().optional(),
  error: z.string().optional(),
  file: z.string().optional(),
  balance: z.number().nullable().optional(),
  askAboveCredits: z.number().optional(),
  defaultModels: z.object({ image: z.string().nullable(), video: z.string().nullable() }).optional(),
  models: z.array(z.looseObject({ name: z.string(), firstFrame: z.boolean().optional() })).optional(),
});

function toolData(text: string) {
  try {
    const parsed = ToolData.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface CallOutcome {
  result: DynamicToolResult;
  data: z.infer<typeof ToolData> | null;
  text: string;
  error: string | undefined;
  approvals: string[];
  holds: { reason: string; call: CreditsHoldCall; balance: number | null }[];
  offers: MediaApprovalOffer[];
  shown: CreditMediaShown[];
  reads: string[][];
  submitted: (typeof submits)[number] | undefined;
  creditsChanges: number;
  reports: CreditMediaReport[];
}

function savedPath(media: CreditMediaShown) {
  return `/saved/generated/${media.name}`;
}

async function call(
  tool: string,
  args: unknown,
  options: {
    approve?: boolean;
    choice?: MediaApprovalChoice;
    unreadable?: string;
    hold?: (wallet: CreditsHoldWallet) => CreditsHoldAnswer;
    requesters?: readonly string[];
  } = {},
): Promise<CallOutcome> {
  const approvals: string[] = [];
  const holds: CallOutcome["holds"] = [];
  const offers: MediaApprovalOffer[] = [];
  const shown: CreditMediaShown[] = [];
  const reads: string[][] = [];
  const before = submits.length;
  const changesBefore = creditsChanges;
  const reportsBefore = reports.length;
  const result = await Effect.runPromise(
    tools.handle({
      agentId: "agent-1",
      turnId: "turn-1",
      tool,
      arguments: args,
      readInputs: (paths) =>
        Effect.suspend(() => {
          reads.push([...paths]);
          if (options.unreadable && paths.includes(options.unreadable))
            return Effect.fail(new CreditMediaToolInputFailed(`${options.unreadable} was not found.`));
          return Effect.succeed(paths.map(() => PNG));
        }),
      approve: (reason, offer) =>
        Effect.sync(() => {
          approvals.push(reason);
          offers.push(offer);
          return { accepted: options.approve ?? true, choice: options.choice ?? null, via: "local" as const };
        }),
      hold: (reason, hold) =>
        Effect.sync(() => {
          holds.push({ reason, call: hold.call, balance: hold.balance });
          return options.hold?.(hold.wallet) ?? { action: "skip" as const };
        }),
      requesters: options.requesters ?? ["member-1"],
      show: (media) =>
        Effect.sync(() => {
          shown.push(media);
          return savedPath(media);
        }),
    }),
  );
  const first = result.contentItems[0];
  const text = first?.type === "inputText" ? first.text : "";
  const data = toolData(text);
  return {
    result,
    data,
    text,
    error: data?.error,
    approvals,
    holds,
    offers,
    shown,
    reads,
    submitted: submits.length > before ? submits.at(-1) : undefined,
    creditsChanges: creditsChanges - changesBefore,
    reports: reports.slice(reportsBefore),
  };
}

async function flow() {
  check(
    "the openbot namespace lists list_media_models, generate_image and generate_video",
    CREDIT_MEDIA_TOOL_DEFINITIONS.every((definition) =>
      OPENBOT_TOOL_DEFINITIONS.some((tool) => tool.name === definition.name),
    ),
  );

  const listed = await call("list_media_models", {});
  const listedModels = listed.data?.models ?? [];
  check(
    "list_media_models gives the models, the balance and the approval limit",
    listed.result.success &&
      listed.data?.balance === 100 &&
      listed.data?.askAboveCredits === 50 &&
      listedModels.length === MODELS.length &&
      listedModels[2]?.firstFrame === true &&
      listedModels[1]?.name === "image-edit · Edit",
    listed.data,
  );
  const videosOnly = await call("list_media_models", { kind: "video" });
  check("list_media_models filters by kind", videosOnly.data?.models?.length === 2, videosOnly.data);

  const image = await call("generate_image", { prompt: "A red boat" });
  check(
    "a cheap image runs with no approval on the first image model and its defaults",
    image.result.success &&
      image.approvals.length === 0 &&
      image.submitted?.request.model === "image-text" &&
      image.submitted.request.aspect === "1:1" &&
      image.submitted.request.resolution === "2K" &&
      image.submitted.request.count === 1,
    { data: image.data, request: image.submitted?.request },
  );
  check(
    "a finished generation tells the clients once that the credits changed, and a model list does not",
    image.creditsChanges === 1 && listed.creditsChanges === 0,
    { image: image.creditsChanges, listed: listed.creditsChanges },
  );
  check(
    "the image shows in the chat as an image generation, and the model sees it",
    image.shown.length === 1 &&
      image.shown[0]?.itemType === "image_generation" &&
      image.shown[0].mimeType === "image/png" &&
      image.shown[0].imageGeneration?.prompt === "A red boat" &&
      image.shown[0].imageGeneration.resolution === "1920 × 1080" &&
      image.shown[0].imageGeneration.aspectRatio === "landscape" &&
      image.data?.status === "shown" &&
      image.result.contentItems[1]?.type === "inputImage",
    { shown: image.shown.map(({ bytes: _bytes, ...rest }) => rest), data: image.data },
  );
  const imageReport = image.reports[0];
  check(
    "a made image gives one report with the agent, the media model, the cost and the charge",
    image.reports.length === 1 &&
      imageReport?.agentId === "agent-1" &&
      imageReport.turnId === "turn-1" &&
      imageReport.kind === "image" &&
      imageReport.outcome === "generated" &&
      typeof imageReport.model === "string" &&
      imageReport.cost !== null &&
      imageReport.charged !== null &&
      imageReport.hold === null,
    imageReport,
  );

  const reused = await call("generate_image", { prompt: "Make it blue", images: [image.data?.file ?? ""] });
  check(
    "the result gives the saved file, and the agent can pass it to a later call",
    image.shown[0] !== undefined &&
      image.data?.file === savedPath(image.shown[0]) &&
      reused.result.success &&
      reused.submitted?.request.model === "image-edit" &&
      JSON.stringify(reused.reads) === JSON.stringify([[savedPath(image.shown[0])]]),
    { shown: image.shown.map(({ bytes: _bytes, ...rest }) => rest), data: image.data },
  );

  const edit = await call("generate_image", { prompt: "Make it blue", images: ["/tmp/a.png", "/tmp/b.jpg"] });
  check(
    "an edit with pictures picks the first image model that takes references and uploads them",
    edit.result.success &&
      edit.submitted?.request.model === "image-edit" &&
      edit.submitted.inputs.length === 2 &&
      edit.submitted.inputs.every((input) => input.role === "reference") &&
      edit.submitted.inputs[1]?.mimeType === "image/jpeg" &&
      JSON.stringify(edit.reads) === JSON.stringify([["/tmp/a.png", "/tmp/b.jpg"]]),
    { request: edit.submitted?.request, roles: edit.submitted?.inputs.map((input) => input.role), reads: edit.reads },
  );

  const tooMany = await call("generate_image", {
    model: "image-text",
    prompt: "x",
    images: ["/tmp/a.png"],
  });
  check(
    "a model that takes no pictures refuses them before any read or charge",
    !tooMany.result.success &&
      tooMany.error === "image-text takes no reference pictures." &&
      tooMany.reads.length === 0 &&
      tooMany.submitted === undefined,
    tooMany.text,
  );

  const badAspect = await call("generate_image", { prompt: "x", aspect: "2:1" });
  check(
    "an aspect that the model does not have gives the aspects of the model",
    !badAspect.result.success && badAspect.error === "aspect must be one of: 16:9, 1:1, 3:4." && !badAspect.submitted,
    badAspect.text,
  );

  check(
    "a bad argument gives an invalid report",
    badAspect.reports.length === 1 && badAspect.reports[0]?.outcome === "invalid",
    badAspect.reports,
  );

  const declined = await call(
    "generate_video",
    { prompt: "Waves", duration: 8, firstFrame: "/tmp/first.png" },
    { approve: false },
  );
  check(
    "a video above the limit asks the user with the model and price, and a decline spends nothing",
    !declined.result.success &&
      declined.error === sourceText("error.agent.creditMediaDeclined") &&
      declined.approvals.length === 1 &&
      declined.approvals[0] === sourceText("status.agent.creditVideoApproval", { model: "video-both", credits: 56 }) &&
      declined.submitted === undefined &&
      declined.shown.length === 0 &&
      declined.creditsChanges === 0,
    { text: declined.text, approvals: declined.approvals },
  );

  const declinedReport = declined.reports[0];
  check(
    "a declined approval gives a declined report with the answer and where it came from",
    declined.reports.length === 1 &&
      declinedReport?.outcome === "declined" &&
      declinedReport.kind === "video" &&
      declinedReport.approval?.accepted === false &&
      declinedReport.approval.via === "local" &&
      declinedReport.references === 1 &&
      declinedReport.charged === null,
    declinedReport,
  );

  const video = await call("generate_video", {
    prompt: "Waves",
    duration: 8,
    firstFrame: "/tmp/first.png",
    lastFrame: "/tmp/last.png",
  });
  check(
    "an approved video sends both frames and shows as a video generation",
    video.result.success &&
      video.approvals.length === 1 &&
      video.submitted?.request.model === "video-both" &&
      video.submitted.request.duration === 8 &&
      video.submitted.request.audio === true &&
      JSON.stringify(video.submitted.inputs.map((input) => input.role)) === JSON.stringify(["first", "last"]) &&
      video.shown[0]?.itemType === "video_generation" &&
      video.shown[0].mimeType === "video/mp4" &&
      video.shown[0].videoGeneration?.durationSeconds === 8 &&
      video.shown[0].videoGeneration.aspectRatio === "landscape" &&
      video.data?.status === "shown" &&
      video.data.file === savedPath(video.shown[0]),
    { request: video.submitted?.request, data: video.data },
  );

  const silent = await call("generate_video", { prompt: "Quiet waves", duration: 8, audio: false });
  check(
    "a silent video uses the silent price and stays under the limit",
    silent.result.success && silent.approvals.length === 0 && silent.submitted?.request.audio === false,
    { request: silent.submitted?.request, approvals: silent.approvals },
  );

  const tooExpensive = await call("generate_video", { prompt: "Waves", duration: 8, resolution: "1080p" });
  check(
    "a price above the balance holds the call with the cost and the balance, and a skip charges nothing",
    !tooExpensive.result.success &&
      tooExpensive.holds.length === 1 &&
      tooExpensive.holds[0]?.reason === sourceText("status.agent.creditsHoldBalance", { credits: 124, balance: 100 }) &&
      tooExpensive.holds[0]?.call.kind === "video" &&
      tooExpensive.holds[0]?.call.cost === 124 &&
      tooExpensive.holds[0]?.balance === 100 &&
      tooExpensive.error?.startsWith("The user skipped this step.") === true &&
      tooExpensive.approvals.length === 0 &&
      tooExpensive.submitted === undefined,
    { text: tooExpensive.text, holds: tooExpensive.holds },
  );

  const skippedReport = tooExpensive.reports[0];
  check(
    "a skipped credits hold gives a skipped report with the balance reason",
    tooExpensive.reports.length === 1 &&
      skippedReport?.outcome === "skipped" &&
      skippedReport.hold?.reason === "balance" &&
      skippedReport.hold.answer === "skipped" &&
      skippedReport.resolution === "1080p" &&
      skippedReport.durationSeconds === 8 &&
      skippedReport.cost === 124,
    skippedReport,
  );

  const funded = await call(
    "generate_video",
    { prompt: "Waves", duration: 8, resolution: "1080p" },
    {
      hold: () => {
        walletBalance = 500;
        return { action: "continue" };
      },
    },
  );
  walletBalance = 100;
  check(
    "when credits arrive during the hold, the same call continues and runs",
    funded.result.success && funded.holds.length === 1 && funded.submitted?.request.resolution === "1080p",
    { text: funded.text, holds: funded.holds },
  );

  check(
    "a hold that continues gives a generated report with the continued answer",
    funded.reports.length === 1 &&
      funded.reports[0]?.outcome === "generated" &&
      funded.reports[0].hold?.answer === "continued",
    funded.reports[0],
  );

  const memberMute = await call(
    "generate_video",
    { prompt: "Waves", duration: 8, resolution: "1080p" },
    { hold: () => ({ action: "mute", responder: { owner: false, person: { id: "member-1", canAdminister: false } } }) },
  );
  const memberMuted = await call("generate_video", { prompt: "Waves", duration: 8, resolution: "1080p" });
  const otherMember = await call(
    "generate_video",
    { prompt: "Waves", duration: 8, resolution: "1080p" },
    { requesters: ["member-2"] },
  );
  check(
    "a member's mute stops the asks for that member only, and the agent is told to say once that it skipped",
    !memberMute.result.success &&
      memberMute.text.includes("not to ask about credits again") &&
      mutes.at(-1)?.id === "member-1" &&
      askWhenBlocked &&
      memberMuted.holds.length === 0 &&
      memberMuted.text.includes("did not ask") &&
      !memberMuted.submitted &&
      otherMember.holds.length === 1,
    { mute: memberMute.text, muted: memberMuted.text },
  );
  check(
    "a muted hold and a call that does not ask give the muted and not_asked reports",
    memberMute.reports[0]?.outcome === "muted" &&
      memberMute.reports[0].hold?.answer === "muted" &&
      memberMuted.reports[0]?.outcome === "not_asked" &&
      memberMuted.reports[0].hold?.answer === "not_asked",
    { mute: memberMute.reports, muted: memberMuted.reports },
  );
  mutedMembers.clear();

  const adminMute = await call(
    "generate_video",
    { prompt: "Waves", duration: 8, resolution: "1080p" },
    { hold: () => ({ action: "mute", responder: { owner: false, person: { id: "admin-1", canAdminister: true } } }) },
  );
  const serverMuted = await call(
    "generate_video",
    { prompt: "Waves", duration: 8, resolution: "1080p" },
    { requesters: ["member-2"] },
  );
  check(
    "an admin's mute turns off the server asks, so no member is asked",
    adminMute.holds.length === 1 && !askWhenBlocked && serverMuted.holds.length === 0 && !serverMuted.submitted,
    { mute: adminMute.text, muted: serverMuted.text },
  );
  askWhenBlocked = true;

  const lastOnly = await call("generate_video", { model: "video-refs", prompt: "x", lastFrame: "/tmp/last.png" });
  check(
    "a frame that the model cannot take is refused with the reason",
    !lastOnly.result.success && lastOnly.error === "video-refs takes no last frame." && !lastOnly.submitted,
    lastOnly.text,
  );

  const unreadable = await call(
    "generate_image",
    { prompt: "x", images: ["/tmp/missing.png"] },
    {
      unreadable: "/tmp/missing.png",
    },
  );
  check(
    "a picture that cannot be read stops before approval and charge",
    !unreadable.result.success &&
      unreadable.error === "/tmp/missing.png was not found." &&
      unreadable.approvals.length === 0 &&
      !unreadable.submitted,
    unreadable.text,
  );

  const strict = await call("generate_image", { prompt: "x", firstFrame: "/tmp/a.png" });
  check("generate_image refuses video fields", !strict.result.success && !strict.submitted, strict.text);

  approvalCredits = 0;
  const askAll = await call("generate_image", { prompt: "A cat" });
  check(
    "a limit of 0 asks for each paid image",
    askAll.result.success &&
      JSON.stringify(askAll.approvals) ===
        JSON.stringify([sourceText("status.agent.creditImageApproval", { model: "image-text", credits: 3 })]),
    askAll.approvals,
  );

  const offer = askAll.offers[0];
  check(
    "the approval offers the agent's model, its settings and the other image models",
    offer?.agentModel === "image-text" &&
      offer.choice.resolution === "2K" &&
      offer.models.map((entry) => entry.id).join() === "image-text,image-edit" &&
      offer.defaultModel === null,
    offer,
  );

  const chosen = await call(
    "generate_image",
    { prompt: "A dog" },
    { choice: { model: "image-text", aspect: "16:9", resolution: "1K", duration: null, audio: false } },
  );
  check(
    "the user's choice in the approval replaces the agent's settings",
    chosen.result.success &&
      chosen.submitted?.request.model === "image-text" &&
      chosen.submitted.request.aspect === "16:9" &&
      chosen.submitted.request.resolution === "1K",
    chosen.submitted?.request,
  );

  const otherModel = await call(
    "generate_image",
    { prompt: "A bird" },
    { choice: { model: "image-edit", aspect: "1:1", resolution: null, duration: null, audio: false } },
  );
  check(
    "the user can pick another model in the approval",
    otherModel.result.success && otherModel.submitted?.request.model === "image-edit",
    otherModel.submitted?.request,
  );

  defaultModels = { image: "image-edit", video: null };
  const preferred = await call("generate_image", { prompt: "A tree" });
  const preferredList = await call("list_media_models", {});
  check(
    "list_media_models names the default model of each kind",
    preferredList.data?.defaultModels?.image === "image-edit" && preferredList.data.defaultModels.video === null,
    preferredList.data?.defaultModels,
  );
  check(
    "with no model from the agent, the server's default image model runs and the approval marks it",
    preferred.result.success &&
      preferred.submitted?.request.model === "image-edit" &&
      preferred.offers[0]?.defaultModel === "image-edit",
    { request: preferred.submitted?.request, offer: preferred.offers[0] },
  );
  const named = await call("generate_image", { prompt: "A tree", model: "image-text" });
  check(
    "a model that the agent names comes before the default model",
    named.result.success && named.submitted?.request.model === "image-text",
    named.submitted?.request,
  );
  defaultModels = { image: null, video: null };
  approvalCredits = DEFAULT_MEDIA_APPROVAL_CREDITS;

  signedIn = false;
  const signedOut = await call("generate_image", { prompt: "x" });
  const signedOutList = await call("list_media_models", {});
  check(
    "with no account or server wallet, the tools tell the agent to sign in and charge nothing",
    !signedOut.result.success &&
      signedOut.error === sourceText("error.billing.mediaSignInRequired") &&
      !signedOutList.result.success &&
      !signedOut.submitted,
    signedOut.text,
  );
  signedIn = true;

  agentsAllowed = false;
  const offImage = await call("generate_image", { prompt: "A red boat" });
  const offVideo = await call("generate_video", { prompt: "A red boat" });
  const offList = await call("list_media_models", {});
  check(
    "when the server turns off agent use of credits, the call holds with that reason and a skip charges nothing",
    !offImage.result.success &&
      offImage.holds[0]?.reason === sourceText("status.agent.creditsHoldAgentsOff") &&
      offImage.holds[0]?.balance === null &&
      !offVideo.result.success &&
      offVideo.holds.length === 1 &&
      offList.result.success &&
      offImage.approvals.length === 0 &&
      !offImage.submitted &&
      !offVideo.submitted,
    { image: offImage.text, video: offVideo.text, list: offList.text },
  );
  const turnedOn = await call(
    "generate_image",
    { prompt: "A red boat" },
    {
      hold: (wallet) => {
        Effect.runSync(wallet.enableAgents());
        return { action: "continue" };
      },
    },
  );
  check(
    "when an admin turns agent use on from the hold, the same call runs",
    agentsAllowed && turnedOn.result.success && turnedOn.holds.length === 1 && Boolean(turnedOn.submitted),
    turnedOn.text,
  );
  check(
    "a hold for agent use gives the agents_off reason",
    turnedOn.reports[0]?.hold?.reason === "agents_off" && turnedOn.reports[0].outcome === "generated",
    turnedOn.reports,
  );
  const onAgain = await call("generate_image", { prompt: "A red boat" });
  check(
    "when the server turns it on again, an image runs with no hold",
    onAgain.result.success && onAgain.holds.length === 0 && Boolean(onAgain.submitted),
  );
}

async function stoppedCall() {
  const submitted = Deferred.makeUnsafe<string>();
  const delivered = Deferred.makeUnsafe<CreditMediaShown>();
  const before = submits.length;
  heldJob = submitted;
  const report = Deferred.makeUnsafe<CreditMediaReport>();
  nextReport = report;
  const running = Effect.runFork(
    tools.handle({
      agentId: "agent-1",
      turnId: "turn-2",
      tool: "generate_video",
      arguments: { prompt: "Slow waves", duration: 4 },
      readInputs: (paths) => Effect.succeed(paths.map(() => PNG)),
      approve: () => Effect.succeed({ accepted: true, choice: null, via: "remote" as const }),
      hold: () => Effect.succeed({ action: "skip" as const }),
      requesters: ["member-1"],
      show: (media) => Deferred.succeed(delivered, media).pipe(Effect.as(savedPath(media))),
    }),
  );
  const jobId = await Effect.runPromise(Deferred.await(submitted));
  const stopped = await Effect.runPromise(Fiber.interrupt(running).pipe(Effect.andThen(Fiber.await(running))));
  runningJobs.set(jobId, true);
  const shown = await Effect.runPromise(Deferred.await(delivered));
  const stoppedReport = await Effect.runPromise(Deferred.await(report));
  nextReport = null;
  check(
    "a stopped call with a paid job reports once, when the job is shown",
    stoppedReport.turnId === "turn-2" &&
      stoppedReport.outcome === "generated" &&
      stoppedReport.approval === null &&
      stoppedReport.charged !== null &&
      reports.filter((item) => item.turnId === "turn-2").length === 1,
    stoppedReport,
  );
  check(
    "a stopped call keeps waiting for a paid job and shows the result in the chat",
    Exit.hasInterrupts(stopped) && shown.itemType === "video_generation" && submits.length === before + 1,
    { jobId, interrupted: Exit.hasInterrupts(stopped), shown: shown.name },
  );
}

let passed = false;
try {
  await flow();
  await stoppedCall();
  passed = checks.every((item) => item.passed);
} finally {
  await Effect.runPromise(Scope.close(toolScope, Exit.void));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
}
for (const item of checks) process.stdout.write(`${item.passed ? "ok  " : "FAIL"} ${item.name}\n`);
process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
if (!passed) process.exit(1);
