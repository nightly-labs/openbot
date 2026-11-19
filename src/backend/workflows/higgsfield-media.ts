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

export const HIGGSFIELD_MCP_HOST = "mcp.higgsfield.ai";

const HIGGSFIELD_MEDIA_HOSTS: ReadonlySet<string> = new Set(["d8j0ntlcm91z4.cloudfront.net"]);
const HIGGSFIELD_DOMAIN = "higgsfield.ai";

const HIGGSFIELD_DEADLINE = { image: Duration.minutes(5), video: Duration.minutes(20) } as const;
const HIGGSFIELD_POLL = { image: Duration.seconds(3), video: Duration.seconds(6) } as const;
const HIGGSFIELD_POLL_SECONDS = { min: 1, max: 15 } as const;
const HIGGSFIELD_CALL_TIMEOUT_MS = 120_000;
const HIGGSFIELD_CREDITS_DEADLINE = Duration.seconds(20);
const HIGGSFIELD_TRANSFER_DEADLINE = { upload: Duration.minutes(2), download: Duration.minutes(5) } as const;
const HIGGSFIELD_POLL_FAILURES = 3;
const HIGGSFIELD_CATALOG_DEADLINE = Duration.seconds(45);
const HIGGSFIELD_PRICE_DEADLINE = Duration.seconds(20);
const HIGGSFIELD_CATALOG_PAGE = 100;
const HIGGSFIELD_CATALOG_PAGES = 10;
const HIGGSFIELD_PRICE_PROMPT = "A picture.";

const TERMINAL_FAILURES: ReadonlySet<string> = new Set(["canceled", "failed"]);
const BLOCKED: ReadonlySet<string> = new Set(["nsfw", "ip_detected"]);

export interface HiggsfieldMediaRequest {
  kind: WorkflowMediaKind;
  model: string;
  prompt: string;
  specs: WorkflowMediaSpecs;
  images: readonly { role: MediaImageRole; attachmentId: string }[];
  plan: HiggsfieldPlan;
}

const notSignedIn = () => mediaFail(sourceText("error.workflow.higgsfieldSignIn"));
const timedOut = () => mediaFail(sourceText("error.workflow.higgsfieldTimeout"));

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
    (reason && /subscription|upgrade|requires? [\w -]{0,24}plan|plan or higher/iu.test(reason))
  )
    return mediaFail(sourceText("error.workflow.higgsfieldNeedsPlan"));
  if (answer?.upgrade_url !== undefined || answer?.recovery_tool === "show_plans_and_credits")
    return mediaFail(sourceText("error.workflow.higgsfieldNoCredits"));
  return reason ? mediaFail(sourceText("error.workflow.higgsfieldFailed", { reason })) : mediaFailed();
}

const HIGGSFIELD_TOOLS = { timeoutMs: HIGGSFIELD_CALL_TIMEOUT_MS, refusal: higgsfieldFailure };

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

function isHiggsfieldMedia(value: string): boolean {
  if (!isHttps(value)) return false;
  const host = new URL(value).hostname;
  return HIGGSFIELD_MEDIA_HOSTS.has(host) || host === HIGGSFIELD_DOMAIN || host.endsWith(`.${HIGGSFIELD_DOMAIN}`);
}

const firstRecord = (value: unknown) => (Array.isArray(value) ? value.find(isDynamicRecord) : undefined) ?? null;

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

function requestMode(plan: HiggsfieldPlan, medias: readonly { role: string }[]): string | undefined {
  if (!plan.mode) return undefined;
  if (medias.some((media) => media.role === "start_image" || media.role === "end_image"))
    return plan.mode.frames ?? plan.mode.text;
  return medias.length > 0 ? (plan.mode.references ?? plan.mode.text) : plan.mode.text;
}

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

function generationFile(generation: DynamicRecord): string | null {
  const results = isDynamicRecord(generation.results) ? generation.results : firstRecord(generation.results);
  const url = mediaText(results?.rawUrl);
  return url && isHiggsfieldMedia(url) ? url : null;
}

function pollDelay(answer: DynamicRecord, kind: WorkflowMediaKind): Duration.Duration {
  const seconds = answer.poll_after_seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return HIGGSFIELD_POLL[kind];
  return Duration.seconds(Math.min(HIGGSFIELD_POLL_SECONDS.max, Math.max(HIGGSFIELD_POLL_SECONDS.min, seconds)));
}

function settled(generation: DynamicRecord): string | McpMediaFailed | null {
  const status = (mediaText(generation.status) ?? "").toLowerCase();
  if (status === "completed") return generationFile(generation) ?? mediaFailed();
  if (BLOCKED.has(status)) return mediaFail(sourceText("error.workflow.higgsfieldBlocked"));
  if (TERMINAL_FAILURES.has(status)) return higgsfieldFailure(mediaReason(generation.error));
  return null;
}

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

function higgsfieldCredits(answer: DynamicRecord): WorkflowMediaCreditBalance | null {
  const available = creditCount(answer.credits);
  return available === null ? null : { available, quota: null };
}

export const readHiggsfieldCredits = Effect.fn("readHiggsfieldCredits")(function* (signIn: McpMediaSignIn) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const client = yield* connectSignedIn(signIn, notSignedIn);
      return higgsfieldCredits(yield* callTool(client, "balance", {}));
    }),
  ).pipe(Effect.timeoutOrElse({ duration: HIGGSFIELD_CREDITS_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});

function catalogPage(answer: DynamicRecord): { items: DynamicRecord[]; next: string | null } {
  const items = Array.isArray(answer.items) ? answer.items.filter(isDynamicRecord) : [];
  return { items, next: answer.has_more === true ? mediaText(answer.next_page_token) : null };
}

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
      return typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits : yield* mediaFailed();
    }),
  ).pipe(Effect.timeoutOrElse({ duration: HIGGSFIELD_PRICE_DEADLINE, orElse: () => Effect.fail(timedOut()) }));
});
