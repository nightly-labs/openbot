/**
 * Makes the image or the video of a canvas step with the tools of Higgsfield's MCP server
 * (https://mcp.higgsfield.ai/mcp), on the Higgsfield sign-in that the user made for the Higgsfield app
 * in Apps.
 *
 * Running a step with a Higgsfield model is the user's request to spend Higgsfield credits. The
 * request always says `use_unlim: false`: OpenBot never spends a free-trial allowance of unlimited
 * generations, because only the user can choose that. The file stays in the user's Higgsfield history
 * with no project, and OpenBot keeps a copy in Storage, as it does for the other media models.
 */

import { readFile } from "node:fs/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { WorkflowMediaCreditBalance, WorkflowMediaKind, WorkflowMediaSpecs } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Duration, Effect } from "effect";
import { type HiggsfieldCatalogEntry, type HiggsfieldPlan, higgsfieldCatalogEntry } from "./higgsfield-catalog";
import {
  callMediaTool,
  connectSignedIn,
  creditCount,
  downloadMedia,
  isHttps,
  type McpMediaDependencies,
  type McpMediaFailed,
  type McpMediaSignIn,
  type McpToolArguments,
  mediaFail,
  mediaFailed,
  mediaReason,
  mediaText,
  pictureExtension,
  resolveMediaInputs,
  uploadToService,
} from "./mcp-media";
import type { MediaImageRole } from "./workflow-walk";

/** The host of Higgsfield's MCP server. An enabled http MCP row with this host is the Higgsfield connection. */
export const HIGGSFIELD_MCP_HOST = "mcp.higgsfield.ai";

/**
 * The hosts that Higgsfield serves results from. OpenBot downloads a result from these hosts only:
 * the CloudFront host of the generation history, and Higgsfield's own hosts.
 */
const HIGGSFIELD_MEDIA_HOSTS: ReadonlySet<string> = new Set(["d8j0ntlcm91z4.cloudfront.net"]);
const HIGGSFIELD_DOMAIN = "higgsfield.ai";

/** How long a step waits for Higgsfield, from the generate call to the finished file. */
const HIGGSFIELD_DEADLINE = { image: Duration.minutes(5), video: Duration.minutes(20) } as const;
/** The wait between two status reads when Higgsfield does not say. `poll_after_seconds` is kept in range. */
const HIGGSFIELD_POLL = { image: Duration.seconds(3), video: Duration.seconds(6) } as const;
const HIGGSFIELD_POLL_SECONDS = { min: 1, max: 15 } as const;
/** One tool call. `job_status` with `sync` waits up to about 25 seconds on Higgsfield's side. */
const HIGGSFIELD_CALL_TIMEOUT_MS = 120_000;
/** A read of the credits that takes longer shows no credits. */
const HIGGSFIELD_CREDITS_DEADLINE = Duration.seconds(20);
/** The longest time for one upload of an input picture, and for the download of the file. */
const HIGGSFIELD_TRANSFER_DEADLINE = { upload: Duration.minutes(2), download: Duration.minutes(5) } as const;
/** How many `job_status` calls in a row can fail before the step fails. */
const HIGGSFIELD_POLL_FAILURES = 3;
/** A read of the model list or of a price that takes longer gives no list or no price. */
const HIGGSFIELD_CATALOG_DEADLINE = Duration.seconds(45);
const HIGGSFIELD_PRICE_DEADLINE = Duration.seconds(20);
/** One page of `models_explore`, and the most pages of one kind. */
const HIGGSFIELD_CATALOG_PAGE = 100;
const HIGGSFIELD_CATALOG_PAGES = 10;
/** The description of a price quote. Higgsfield prices a file by its choices, not by its words. */
const HIGGSFIELD_PRICE_PROMPT = "A picture.";

const TERMINAL_FAILURES: ReadonlySet<string> = new Set(["canceled", "failed"]);
/** Higgsfield's checks stopped the file. Only the user can confirm the rights to see it. */
const BLOCKED: ReadonlySet<string> = new Set(["nsfw", "ip_detected"]);

export interface HiggsfieldMediaRequest {
  kind: WorkflowMediaKind;
  /** The Higgsfield model id, such as "nano_banana_pro". */
  model: string;
  prompt: string;
  specs: WorkflowMediaSpecs;
  images: readonly { role: MediaImageRole; attachmentId: string }[];
  /** How the request takes the pictures and the choices of the step. */
  plan: HiggsfieldPlan;
}

const notSignedIn = () => mediaFail(sourceText("error.workflow.higgsfieldSignIn"));
const timedOut = () => mediaFail(sourceText("error.workflow.higgsfieldTimeout"));

/**
 * The error for a refusal or a failed job, from the words of Higgsfield and, when the answer has
 * them, its billing fields: `monetization_intent` says whether credits or a plan are missing.
 */
function higgsfieldFailure(reason: string | null, answer: DynamicRecord | null = null): McpMediaFailed {
  const intent = mediaText(answer?.monetization_intent);
  if (
    intent === "topup" ||
    intent === "auto_refill" ||
    (reason && /insufficient|not enough credits|out of credits/iu.test(reason))
  )
    return mediaFail(sourceText("error.workflow.higgsfieldNoCredits"));
  if (
    intent === "upgrade" ||
    intent === "trial" ||
    // Higgsfield says, for example, "Requires basic plan or higher." for a model that a free account
    // cannot use.
    (reason && /subscription|upgrade|requires? [\w -]{0,24}plan|plan or higher/iu.test(reason))
  )
    return mediaFail(sourceText("error.workflow.higgsfieldNeedsPlan"));
  if (answer?.upgrade_url !== undefined || answer?.recovery_tool === "show_plans_and_credits")
    return mediaFail(sourceText("error.workflow.higgsfieldNoCredits"));
  return reason ? mediaFail(sourceText("error.workflow.higgsfieldFailed", { reason })) : mediaFailed();
}

const HIGGSFIELD_TOOLS = { timeoutMs: HIGGSFIELD_CALL_TIMEOUT_MS, refusal: higgsfieldFailure };

/**
 * Calls one tool. Higgsfield can refuse in a normal answer, with an `error`, an upgrade link or the
 * question about the unlimited allowance, so those fail here too.
 */
const callTool = (client: Client, name: string, args: McpToolArguments) =>
  callMediaTool(client, HIGGSFIELD_TOOLS, name, args).pipe(
    Effect.flatMap((answer) =>
      answer.error !== undefined ||
      answer.upgrade_url !== undefined ||
      answer.recovery_tool !== undefined ||
      answer.unlim_choice !== undefined
        ? Effect.fail(higgsfieldFailure(mediaReason(answer.error), answer))
        : Effect.succeed(answer),
    ),
  );

/** Whether a result address is on Higgsfield's file hosts, over https. */
function isHiggsfieldMedia(value: string): boolean {
  if (!isHttps(value)) return false;
  const host = new URL(value).hostname;
  return HIGGSFIELD_MEDIA_HOSTS.has(host) || host === HIGGSFIELD_DOMAIN || host.endsWith(`.${HIGGSFIELD_DOMAIN}`);
}

const firstRecord = (value: unknown) => (Array.isArray(value) ? value.find(isDynamicRecord) : undefined) ?? null;

/** Puts one input picture in the user's Higgsfield uploads and answers its media id. */
const uploadPicture = Effect.fnUntraced(function* (
  client: Client,
  file: { path: string; mimeType: string },
  index: number,
) {
  const bytes = yield* Effect.tryPromise({ try: () => readFile(file.path), catch: () => mediaFailed() });
  const answer = yield* callTool(client, "media_upload", {
    filename: `openbot-input-${index + 1}.${pictureExtension(file.mimeType)}`,
    content_type: file.mimeType,
  });
  const target = firstRecord(answer.uploads);
  const uploadUrl = mediaText(target?.upload_url);
  const media = mediaText(target?.media_id);
  if (!target || !uploadUrl || !media) return yield* mediaFailed();
  // Higgsfield chooses the upload address. It must not point at this computer or its local network.
  yield* uploadToService(
    {
      url: uploadUrl,
      method: mediaText(target.method)?.toUpperCase() ?? "PUT",
      headers: { "Content-Type": mediaText(target.content_type) ?? file.mimeType },
      body: bytes,
    },
    HIGGSFIELD_TRANSFER_DEADLINE.upload,
    timedOut,
  );
  const confirmed = yield* callTool(client, "media_confirm", { type: "image", media_id: media });
  const results = Array.isArray(confirmed.results) ? confirmed.results.filter(isDynamicRecord) : [];
  if (!results.some((result) => result.media_id === media)) return yield* mediaFailed();
  return media;
});

/**
 * The `medias` of the request: each picture in a role that the model takes, within its limits. A
 * model that takes frames but no references (Wan 2.7) gets a reference as the frame that is still
 * free, first frame before last frame, as Higgsfield itself does with such a request.
 */
function requestMedias(
  plan: HiggsfieldPlan,
  media: (role: MediaImageRole) => string[],
): { value: string; role: string }[] {
  const asFrames = (plan.start || plan.end) && plan.referenceRole === null ? media("reference") : [];
  const first = plan.start ? (media("first")[0] ?? asFrames.shift()) : undefined;
  const lastFrame = plan.end ? (media("last")[0] ?? asFrames.shift()) : undefined;
  const last = plan.endNeedsStart && first === undefined ? undefined : lastFrame;
  const frames = [
    ...(first === undefined ? [] : [{ value: first, role: "start_image" }]),
    ...(last === undefined ? [] : [{ value: last, role: "end_image" }]),
  ];
  const role = plan.referenceRole;
  if (role === null || (plan.exclusive && frames.length > 0)) return frames;
  const room = Math.max(0, Math.min(plan.references, (plan.total ?? Number.POSITIVE_INFINITY) - frames.length));
  return [
    ...frames,
    ...media("reference")
      .slice(0, room)
      .map((value) => ({ value, role })),
  ];
}

/**
 * The `mode` of the request, from the pictures it has. With a frame it is the frame mode; Kling uses
 * the references there as ordered middle frames.
 */
function requestMode(plan: HiggsfieldPlan, medias: readonly { role: string }[]): string | undefined {
  if (!plan.mode) return undefined;
  if (medias.some((media) => media.role === "start_image" || media.role === "end_image"))
    return plan.mode.frames ?? plan.mode.text;
  return medias.length > 0 ? (plan.mode.references ?? plan.mode.text) : plan.mode.text;
}

/**
 * The choices of the step as the model takes them: aspect, resolution, length and background. GPT
 * Image is told "opaque" for a solid background: its default, "auto", can make a clear background
 * that the canvas did not ask for.
 */
function requestChoices(kind: WorkflowMediaKind, specs: WorkflowMediaSpecs, plan: HiggsfieldPlan): McpToolArguments {
  const resolution = specs.resolution
    ? plan.resolution
      ? { [plan.resolution.param]: plan.resolution.values[specs.resolution] ?? specs.resolution.toLowerCase() }
      : { resolution: specs.resolution.toLowerCase() }
    : {};
  const background =
    kind !== "image" || !plan.background
      ? {}
      : plan.background.param === "remove_bg"
        ? specs.transparent
          ? { remove_bg: true }
          : {}
        : specs.transparent
          ? { background: "transparent" }
          : plan.background.opaque
            ? { background: "opaque" }
            : {};
  return {
    aspect_ratio: specs.aspect,
    ...resolution,
    ...(kind === "video" ? { duration: specs.duration } : {}),
    ...background,
  };
}

/** The address of the finished file in a generation, or null. */
function generationFile(generation: DynamicRecord): string | null {
  const results = isDynamicRecord(generation.results) ? generation.results : firstRecord(generation.results);
  const url = mediaText(results?.rawUrl);
  return url && isHiggsfieldMedia(url) ? url : null;
}

/** The wait before the next status read: Higgsfield's `poll_after_seconds`, kept in range. */
function pollDelay(answer: DynamicRecord, kind: WorkflowMediaKind): Duration.Duration {
  const seconds = answer.poll_after_seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return HIGGSFIELD_POLL[kind];
  return Duration.seconds(Math.min(HIGGSFIELD_POLL_SECONDS.max, Math.max(HIGGSFIELD_POLL_SECONDS.min, seconds)));
}

/** What a generation's status means: its file, a failure, or null while it runs. */
function settled(generation: DynamicRecord): string | McpMediaFailed | null {
  const status = (mediaText(generation.status) ?? "").toLowerCase();
  if (status === "completed") return generationFile(generation) ?? mediaFailed();
  if (BLOCKED.has(status)) return mediaFail(sourceText("error.workflow.higgsfieldBlocked"));
  if (TERMINAL_FAILURES.has(status)) return higgsfieldFailure(mediaReason(generation.error));
  return null;
}

/**
 * Asks for the job until it is done, and answers the address of its file. A short network failure
 * must not lose a job that Higgsfield already charged for, and the generate call is never sent again.
 */
const waitForFile = Effect.fnUntraced(function* (client: Client, job: string, kind: WorkflowMediaKind) {
  let failures = 0;
  while (true) {
    const answer = yield* callTool(client, "job_status", { jobId: job, sync: true }).pipe(Effect.result);
    if (answer._tag === "Failure") {
      failures += 1;
      if (failures >= HIGGSFIELD_POLL_FAILURES) return yield* answer.failure;
      yield* Effect.sleep(HIGGSFIELD_POLL[kind]);
      continue;
    }
    failures = 0;
    const generation = isDynamicRecord(answer.success.generation) ? answer.success.generation : null;
    if (!generation) return yield* mediaFailed();
    const result = settled(generation);
    if (typeof result === "string") return result;
    if (result) return yield* result;
    yield* Effect.sleep(pollDelay(answer.success, kind));
  }
});

/**
 * Makes one file with Higgsfield and keeps it in Storage. Answers the id of the stored attachment.
 */
export const generateHiggsfieldMedia = Effect.fn("generateHiggsfieldMedia")(function* (
  dependencies: McpMediaDependencies,
  request: HiggsfieldMediaRequest,
) {
  const signIn = dependencies.signIn();
  if (!signIn) return yield* notSignedIn();
  const files = yield* resolveMediaInputs(dependencies, request.images);
  const made = yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      // Only the pictures that the request sends, and one upload for each file, also when a picture is
      // both frames.
      const sent = requestMedias(request.plan, (role) =>
        files.filter((file) => file.role === role).map((file) => file.path),
      );
      const uploaded = new Map<string, string>();
      for (const { value: path } of sent) {
        if (uploaded.has(path)) continue;
        const file = files.find((candidate) => candidate.path === path);
        if (!file) return yield* mediaFailed();
        uploaded.set(path, yield* uploadPicture(client, file, uploaded.size));
      }
      const medias = sent.flatMap((media) => {
        const value = uploaded.get(media.value);
        return value ? [{ value, role: media.role }] : [];
      });
      const params = {
        model: request.model,
        prompt: request.prompt,
        count: 1,
        use_unlim: false,
        ...requestChoices(request.kind, request.specs, request.plan),
        mode: requestMode(request.plan, medias),
        ...(medias.length > 0 ? { medias } : {}),
      };
      const answer = yield* callTool(client, request.kind === "video" ? "generate_video" : "generate_image", {
        params,
      });
      const job = firstRecord(answer.results);
      const id = mediaText(job?.id);
      if (!job || !id) return yield* mediaFailed();
      const now = settled(job);
      if (typeof now === "string") return now;
      if (now) return yield* now;
      return yield* waitForFile(client, id, request.kind).pipe(
        Effect.timeoutOrElse({ duration: HIGGSFIELD_DEADLINE[request.kind], orElse: () => Effect.fail(timedOut()) }),
      );
    }),
  );
  const file = yield* downloadMedia(made, request.kind, {
    allowed: isHiggsfieldMedia,
    deadline: HIGGSFIELD_TRANSFER_DEADLINE.download,
    timedOut,
  });
  const stored = yield* dependencies
    .store({
      bytes: file.bytes,
      kind: request.kind,
      name: `higgsfield-${request.kind}.${file.extension}`,
      mimeType: file.mimeType,
    })
    .pipe(Effect.mapError(() => mediaFailed()));
  return stored.id;
});

/** The credits in a `balance` answer. Higgsfield can count part of a credit; the count is rounded down. */
function higgsfieldCredits(answer: DynamicRecord): WorkflowMediaCreditBalance | null {
  const available = creditCount(answer.credits);
  return available === null ? null : { available, quota: null };
}

/**
 * The credits that the Higgsfield sign-in can spend now, or null when Higgsfield does not tell them.
 * `balance` only reads the balance: it spends no credits.
 */
export const readHiggsfieldCredits = Effect.fn("readHiggsfieldCredits")(function* (signIn: McpMediaSignIn) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      return higgsfieldCredits(yield* callTool(client, "balance", {}));
    }),
  ).pipe(Effect.timeoutOrElse({ duration: HIGGSFIELD_CREDITS_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});

/** One page of `models_explore`: its items, and the cursor of the next page or null. */
function catalogPage(answer: DynamicRecord): { items: DynamicRecord[]; next: string | null } {
  const items = Array.isArray(answer.items) ? answer.items.filter(isDynamicRecord) : [];
  return { items, next: answer.has_more === true ? mediaText(answer.next_page_token) : null };
}

/**
 * The image and video models of Higgsfield's catalog that the canvas can run, with their plans.
 * `models_explore` only reads the catalog: it spends no credits.
 */
export const readHiggsfieldCatalog = Effect.fn("readHiggsfieldCatalog")(function* (signIn: McpMediaSignIn) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      const entries: HiggsfieldCatalogEntry[] = [];
      const seen = new Set<string>();
      for (const type of ["image", "video"] as const) {
        let after: string | null = null;
        for (let page = 0; page < HIGGSFIELD_CATALOG_PAGES; page += 1) {
          const answer = catalogPage(
            yield* callTool(client, "models_explore", {
              action: "list",
              type,
              limit: HIGGSFIELD_CATALOG_PAGE,
              ...(after ? { after } : {}),
            }),
          );
          for (const item of answer.items) {
            const entry = higgsfieldCatalogEntry(item);
            if (!entry || seen.has(entry.model.id)) continue;
            seen.add(entry.model.id);
            entries.push(entry);
          }
          after = answer.next;
          if (!after) break;
        }
      }
      return entries;
    }),
  ).pipe(Effect.timeoutOrElse({ duration: HIGGSFIELD_CATALOG_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});

export interface HiggsfieldPriceRequest {
  kind: WorkflowMediaKind;
  model: string;
  specs: WorkflowMediaSpecs;
  plan: HiggsfieldPlan;
}

/**
 * What one file costs with the choices of the step, in credits, or null when Higgsfield gives no
 * price. `get_cost` only asks for the price: Higgsfield starts no job and spends no credits. The quote
 * sends no picture, so a mode is the mode with no picture.
 */
export const readHiggsfieldPrice = Effect.fn("readHiggsfieldPrice")(function* (
  signIn: McpMediaSignIn,
  request: HiggsfieldPriceRequest,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      const answer = yield* callTool(client, request.kind === "video" ? "generate_video" : "generate_image", {
        params: {
          model: request.model,
          prompt: HIGGSFIELD_PRICE_PROMPT,
          count: 1,
          use_unlim: false,
          ...requestChoices(request.kind, request.specs, request.plan),
          mode: request.plan.mode?.text,
          get_cost: true,
        },
      });
      const cost = isDynamicRecord(answer.cost) ? answer.cost : null;
      const credits = cost?.credits_exact ?? cost?.credits;
      // An answer without a price fails, so the cache does not keep it: it can come from a short fault.
      return typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits : yield* mediaFailed();
    }),
  ).pipe(Effect.timeoutOrElse({ duration: HIGGSFIELD_PRICE_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});
